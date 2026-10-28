package io.github.missionaryj.patrolradar;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.ParcelUuid;
import android.os.PowerManager;
import android.util.SparseArray;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Foreground service running a PASSIVE BLE scan (BluetoothLeScanner.startScan only).
 * Never connects, pairs, bonds or writes. MAC addresses are replaced by a salted SHA-256 inside
 * this service; the salt is random per scan session and lives only in memory. Nothing is stored
 * or uploaded here; adverts are only handed to the in-app web UI.
 */
public class ScanService extends Service {
    public interface Sink { void onAdvert(JSONObject advert); void onState(String state, String detail); }
    public static volatile Sink sink;
    public static volatile boolean running;

    static final String CHANNEL = "patrol_scan_v2"; // v2: IMPORTANCE_DEFAULT (silent); old LOW channel was hidden on some OEM Android 7-11 builds
    static final int NOTIF_ID = 4711;
    private BluetoothLeScanner scanner;
    private ScanCallback callback;
    private byte[] salt;
    private PowerManager.WakeLock wakeLock;
    private long count;

    public static void start(Context ctx, String mode, boolean filtered, int[] companyIds, String[] uuids16) {
        Intent i = new Intent(ctx, ScanService.class);
        i.putExtra("mode", mode); i.putExtra("filtered", filtered); i.putExtra("companyIds", companyIds); i.putExtra("uuids", uuids16);
        ContextCompat.startForegroundService(ctx, i);
    }
    public static void stop(Context ctx) { ctx.stopService(new Intent(ctx, ScanService.class)); }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try { startAsForeground(); }
        catch (Exception e) { emitState("error", "Could not show scan notification: " + e); stopSelf(); return START_NOT_STICKY; }
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        stopScan();
        salt = new byte[16]; new SecureRandom().nextBytes(salt);
        String mode = intent.getStringExtra("mode");
        boolean filtered = intent.getBooleanExtra("filtered", true);
        int[] cids = intent.getIntArrayExtra("companyIds");
        String[] uuids = intent.getStringArrayExtra("uuids");
        try { startScan(mode == null ? "balanced" : mode, filtered, cids, uuids); }
        catch (Exception e) { emitState("error", "Scan could not start: " + e); stopSelf(); }
        return START_NOT_STICKY; // no silent auto-restart after the OS kills us; the user restarts from the app
    }

    private void startAsForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            if (nm.getNotificationChannel("patrol_scan") != null) nm.deleteNotificationChannel("patrol_scan");
            NotificationChannel c = new NotificationChannel(CHANNEL, "Background scan", NotificationManager.IMPORTANCE_DEFAULT);
            c.setSound(null, null); c.enableVibration(false); c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("Patrol Radar is scanning")
            .setContentText("Passive Bluetooth scan. Open the app and tap Stop to end.")
            .setOngoing(true).setContentIntent(pi).setOnlyAlertOnce(true).setSilent(true).setCategory(NotificationCompat.CATEGORY_SERVICE).setPriority(NotificationCompat.PRIORITY_DEFAULT).build();
        int type = 0;
        if (Build.VERSION.SDK_INT >= 29) {
            type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE;
            if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
                type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION; // keeps the map's GPS fix alive with the screen off
        }
        ServiceCompat.startForeground(this, NOTIF_ID, n, type);
    }

    @SuppressLint("MissingPermission")
    private void startScan(String mode, boolean filtered, int[] cids, String[] uuids) {
        BluetoothManager bm = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        BluetoothAdapter ad = bm == null ? null : bm.getAdapter();
        if (ad == null || !ad.isEnabled()) { emitState("error", "Bluetooth is off"); stopSelf(); return; }
        scanner = ad.getBluetoothLeScanner();
        if (scanner == null) { emitState("error", "BLE scanner unavailable"); stopSelf(); return; }
        int sm = "lowLatency".equals(mode) ? ScanSettings.SCAN_MODE_LOW_LATENCY : "lowPower".equals(mode) ? ScanSettings.SCAN_MODE_LOW_POWER : ScanSettings.SCAN_MODE_BALANCED;
        ScanSettings.Builder sb = new ScanSettings.Builder().setScanMode(sm);
        if (Build.VERSION.SDK_INT >= 23) sb.setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES).setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE);
        // Older chipsets (many Android 7-11 phones) reject non-legacy scans; only use extended scanning when supported.
        if (Build.VERSION.SDK_INT >= 26 && ad.isLeExtendedAdvertisingSupported()) sb.setLegacy(false).setPhy(ScanSettings.PHY_LE_ALL_SUPPORTED);
        List<ScanFilter> filters = new ArrayList<>();
        if (filtered) {
            if (cids != null) for (int c : cids) filters.add(new ScanFilter.Builder().setManufacturerData(c, new byte[0]).build());
            if (uuids != null) for (String u : uuids) {
                ParcelUuid pu = ParcelUuid.fromString("0000" + u + "-0000-1000-8000-00805f9b34fb");
                filters.add(new ScanFilter.Builder().setServiceUuid(pu).build());
                filters.add(new ScanFilter.Builder().setServiceData(pu, new byte[0]).build());
            }
        }
        callback = new ScanCallback() {
            @Override public void onScanResult(int t, ScanResult r) { deliver(r); }
            @Override public void onBatchScanResults(List<ScanResult> rs) { for (ScanResult r : rs) deliver(r); }
            @Override public void onScanFailed(int code) { emitState("error", "Scan failed (code " + code + (code == 6 ? ": started too often, wait 30 s" : "") + ")"); }
        };
        try { scanner.startScan(filters, sb.build(), callback); }
        catch (SecurityException e) { emitState("error", "Nearby devices permission missing"); stopSelf(); return; }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "patrolradar:scan");
        wakeLock.acquire(6 * 60 * 60 * 1000L); // hard cap 6 h
        running = true; count = 0;
        emitState("scanning", mode + (filtered ? " · police filters" : " · all devices"));
    }

    private void deliver(ScanResult r) {
        Sink s = sink; if (s == null) return;
        try {
            JSONObject o = new JSONObject();
            o.put("id", hash(r.getDevice().getAddress()));
            o.put("rssi", r.getRssi());
            ScanRecord rec = r.getScanRecord();
            if (rec != null) {
                if (rec.getDeviceName() != null) o.put("name", rec.getDeviceName());
                if (rec.getTxPowerLevel() != Integer.MIN_VALUE) o.put("txPower", rec.getTxPowerLevel());
                SparseArray<byte[]> m = rec.getManufacturerSpecificData();
                JSONObject mfr = new JSONObject();
                if (m != null) for (int i = 0; i < m.size(); i++) mfr.put(String.valueOf(m.keyAt(i)), hex(m.valueAt(i)));
                o.put("mfr", mfr);
                JSONArray us = new JSONArray();
                if (rec.getServiceUuids() != null) for (ParcelUuid u : rec.getServiceUuids()) us.put(u.toString());
                o.put("uuids", us);
                JSONObject svc = new JSONObject();
                Map<ParcelUuid, byte[]> sd = rec.getServiceData();
                if (sd != null) for (Map.Entry<ParcelUuid, byte[]> e : sd.entrySet()) svc.put(e.getKey().toString(), hex(e.getValue()));
                o.put("svc", svc);
            }
            count++;
            s.onAdvert(o);
        } catch (Exception ignored) { }
    }

    private String hash(String addr) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        md.update(salt); md.update(addr.getBytes(StandardCharsets.UTF_8));
        return "n" + hex(md.digest()).substring(0, 16);
    }
    private static String hex(byte[] b) { if (b == null) return ""; StringBuilder sb = new StringBuilder(); for (byte x : b) sb.append(String.format("%02x", x)); return sb.toString(); }
    private void emitState(String st, String d) { Sink s = sink; if (s != null) s.onState(st, d); }

    @SuppressLint("MissingPermission")
    private void stopScan() {
        try { if (scanner != null && callback != null) scanner.stopScan(callback); } catch (Exception ignored) { }
        scanner = null; callback = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null; running = false;
    }

    @Override public void onDestroy() { stopScan(); salt = null; emitState("stopped", ""); super.onDestroy(); }
}
