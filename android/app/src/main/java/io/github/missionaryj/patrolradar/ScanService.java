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
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
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
    public interface Sink { void onAdvert(JSONObject advert); void onState(String state, String detail); default void onWifi(JSONObject match) { } }
    public static volatile Sink sink;
    public static volatile boolean running;
    /** Session still requested, including the gap between bounded retry attempts. */
    public static volatile boolean sessionActive;
    /** "limit" after the 6-hour cap stops the session; cleared when the user starts again. */
    public static volatile String stopReason = "";
    private static volatile boolean uiForeground = true;
    static void setUiForeground(boolean foreground) { uiForeground = foreground; }

    static final String CHANNEL = "patrol_scan_v2"; // v2: IMPORTANCE_DEFAULT (silent); old LOW channel was hidden on some OEM Android 7-11 builds
    static final int NOTIF_ID = 4711;
    private BluetoothLeScanner scanner;
    private ScanCallback callback;
    private byte[] salt;
    private PowerManager.WakeLock wakeLock;
    private ScanHealth health = new ScanHealth();
    private boolean supervising;
    private WifiWatcher wifi;
    /** OUI prefixes ("AA:BB:CC") from the web signature registry. Compared in memory only; the MAC is never stored or sent. */
    private String[] ouis = new String[0];

    // ---- scan supervisor (1.0.23): stall detection, periodic restart, screen-off filtered fallback ----
    /** Proactive restart period: some Android 7-11 stacks silently stop delivering after a few minutes. */
    static final long PERIODIC_RESTART_MS = 4 * 60_000L;
    /** Unfiltered scan with the screen on: no callback for this long counts as a stall. */
    static final long NO_CALLBACK_STALL_MS = 45_000L;
    static final long WATCHDOG_TICK_MS = 15_000L;
    /** Android blocks the 6th startScan within 30 s (SCAN_FAILED_SCANNING_TOO_FREQUENTLY). We allow at most 3. */
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean limitEnded;
    /** Fires once, on this service, including while the app is backgrounded. User Stop cancels it. */
    private final Runnable sessionLimit = () -> {
        if (!supervising || limitEnded) return;
        limitEnded = true;
        stopReason = "limit";
        PoliceAlertNotifications.showScanEnded(this);
        emitState("error", PoliceAlertNotifications.SCAN_ENDED_TEXT);
        stopSelf();
    };
    private static final java.util.ArrayDeque<Long> starts = new java.util.ArrayDeque<>();
    private String reqMode = "balanced"; private boolean reqFiltered = true; private int[] reqCids; private String[] reqUuids;
    private boolean screenOn = true, activeFiltered = true;
    private long lastAdvertAt, lastStartAt, screenOffSince, screenOffTotalMs, windowStart; private int windowCount; private double baselinePerMin, nativeRatePerMin;
    private int restartsStall, restartsPeriodic, restartsScreen, failedRestarts; private boolean quiet;
    private BroadcastReceiver screenRx;
    /** Coarse, in-memory notification suppression. Only per-session salted device hashes are kept. */
    private final java.util.Map<String, Long> alertedDevices = new java.util.HashMap<>();
    private long lastNativeAlertAt = -45_000L;
    private static final ParcelUuid[] AXON_UUIDS = {
        ParcelUuid.fromString("0000fe6b-0000-1000-8000-00805f9b34fb"),
        ParcelUuid.fromString("0000fe6c-0000-1000-8000-00805f9b34fb"),
        ParcelUuid.fromString("0000fc81-0000-1000-8000-00805f9b34fb")
    };

    /** Pure stall rule (used by the native supervisor). Only meaningful for an unfiltered scan with the screen on. */
    static boolean isStalled(long sinceLastAdvertMs, double lastMinRate, double baselinePerMin) {
        if (sinceLastAdvertMs >= NO_CALLBACK_STALL_MS) return true;
        return baselinePerMin >= 60 && lastMinRate < baselinePerMin * 0.1;
    }
    /**
     * Pure OUI check (unit-testable). Returns the matched OUI prefix or null. Only PUBLIC addresses count: on API 35+
     * the address type is read; below that, random addresses are rejected when their top two bits mark them static
     * (11) or resolvable (01). A non-resolvable random address (00) cannot be told apart below API 35; the prefix is
     * a registered IEEE block, so the chance of a random match is 1 in 2^22, and the signature is low weight anyway.
     */
    static String ouiOf(String addr, int addrType, String[] ouis) {
        if (addr == null || addr.length() < 8 || ouis == null) return null;
        if (addrType > 0) return null; // 0 = PUBLIC, -1 = unknown (pre-API 35)
        String p = addr.substring(0, 8).toUpperCase();
        int top = Integer.parseInt(p.substring(0, 2), 16) >> 6;
        if (addrType < 0 && (top == 3 || top == 1)) return null;
        for (String o : ouis) if (p.equals(o)) return o;
        return null;
    }

    public static void start(Context ctx, String mode, boolean filtered, int[] companyIds, String[] uuids16) { start(ctx, mode, filtered, companyIds, uuids16, null); }
    public static void start(Context ctx, String mode, boolean filtered, int[] companyIds, String[] uuids16, String wifiRulesJson) { start(ctx, mode, filtered, companyIds, uuids16, wifiRulesJson, null); }
    public static void start(Context ctx, String mode, boolean filtered, int[] companyIds, String[] uuids16, String wifiRulesJson, String[] ouis) {
        Intent i = new Intent(ctx, ScanService.class);
        if (wifiRulesJson != null) i.putExtra("wifiRules", wifiRulesJson);
        i.putExtra("mode", mode); i.putExtra("filtered", filtered); i.putExtra("companyIds", companyIds); i.putExtra("uuids", uuids16); if (ouis != null) i.putExtra("ouis", ouis);
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
        alertedDevices.clear(); lastNativeAlertAt = -45_000L;
        String mode = intent.getStringExtra("mode");
        boolean filtered = intent.getBooleanExtra("filtered", true);
        int[] cids = intent.getIntArrayExtra("companyIds");
        String[] uuids = intent.getStringArrayExtra("uuids");
        String[] o = intent.getStringArrayExtra("ouis"); ouis = o == null ? new String[0] : o;
        reqMode = mode == null ? "balanced" : mode; reqFiltered = filtered; reqCids = cids; reqUuids = uuids;
        restartsStall = restartsPeriodic = restartsScreen = failedRestarts = 0; quiet = false; screenOffTotalMs = 0; baselinePerMin = 0; nativeRatePerMin = 0;
        PowerManager pmx = (PowerManager) getSystemService(POWER_SERVICE);
        screenOn = pmx == null || pmx.isInteractive(); screenOffSince = screenOn ? 0 : SystemClock.elapsedRealtime();
        health = new ScanHealth(); lastAdvertAt = 0; windowCount = 0; windowStart = SystemClock.elapsedRealtime();
        supervising = true; sessionActive = true; stopReason = ""; limitEnded = false; health.started("initial");
        attemptStart("initial");
        registerScreen();
        handler.removeCallbacks(tick); handler.postDelayed(tick, WATCHDOG_TICK_MS);
        handler.postDelayed(sessionLimit, ScanHealth.SESSION_LIMIT_MS);
        emitHealth();
        String wr = intent.getStringExtra("wifiRules");
        if (wr != null && supervising && !"failed".equals(health.state)) {
            try {
                wifi = new WifiWatcher(this, new JSONArray(wr), this::hash, m -> { Sink s = sink; if (s != null) s.onWifi(m); });
                wifi.start();
            } catch (Exception e) { emitState("wifi-error", String.valueOf(e.getMessage())); }
        }
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
        if (ad == null || !ad.isEnabled()) throw new IllegalStateException("Bluetooth is off");
        scanner = ad.getBluetoothLeScanner();
        if (scanner == null) throw new IllegalStateException("BLE scanner unavailable");
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
            @Override public void onScanResult(int t, ScanResult r) {
                handler.post(() -> { if (supervising && callback == this) deliver(r); });
            }
            @Override public void onBatchScanResults(List<ScanResult> rs) {
                handler.post(() -> { if (supervising && callback == this) for (ScanResult r : rs) deliver(r); });
            }
            @Override public void onScanFailed(int code) {
                handler.post(() -> { if (supervising && callback == this) scanFailed(code); });
            }
        };
        // Count every platform invocation, including synchronous exceptions.
        starts.addLast(SystemClock.elapsedRealtime());
        scanner.startScan(filters, sb.build(), callback);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (wakeLock == null || !wakeLock.isHeld()) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "patrolradar:scan");
            wakeLock.acquire(ScanHealth.SESSION_LIMIT_MS); // same 6 h cap as sessionLimit
        }
        long now = SystemClock.elapsedRealtime(); lastStartAt = now; windowStart = now; windowCount = 0; nativeRatePerMin = 0; activeFiltered = !filters.isEmpty();
        running = true;
        emitState("scanning", mode + (filtered ? " · police filters" : " · all devices"));
    }

    private void deliver(ScanResult r) {
        long now = SystemClock.elapsedRealtime();
        lastAdvertAt = now; windowCount++;
        boolean recovered = health.callback(now);
        if (quiet || recovered) { quiet = false; emitState("recovered", "Native callbacks resumed"); emitHealth(); }
        maybeAlertInBackground(r, now);
        Sink s = sink; if (s == null) return;
        try {
            JSONObject o = new JSONObject();
            String addr = r.getDevice().getAddress();
            o.put("id", hash(addr));
            int at = -1; if (Build.VERSION.SDK_INT >= 35) { try { at = r.getDevice().getAddressType(); } catch (Throwable ignored) { } }
            String oui = ouiOf(addr, at, ouis);
            if (oui != null) o.put("oui", oui); // only the vendor prefix of a listed OUI, never the address
            o.put("rssi", r.getRssi());
            // When the radio heard it (epoch ms), not when JS got it: batched/late delivery would smear the RSSI-peak time.
            o.put("t", System.currentTimeMillis() - (android.os.SystemClock.elapsedRealtimeNanos() - r.getTimestampNanos()) / 1_000_000L);
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
            s.onAdvert(o);
        } catch (Exception ignored) { }
    }

    /** Runs on the scanner service thread even when the WebView is suspended or no plugin sink exists. */
    private void maybeAlertInBackground(ScanResult result, long now) {
        if (uiForeground || salt == null || !supervising) return;
        ScanRecord record = result.getScanRecord();
        if (record == null) return;
        try {
            java.util.List<byte[]> payloads = new ArrayList<>();
            SparseArray<byte[]> mfr = record.getManufacturerSpecificData();
            if (mfr != null) for (int i = 0; i < mfr.size(); i++) payloads.add(mfr.valueAt(i));
            Map<ParcelUuid, byte[]> services = record.getServiceData();
            if (services != null) payloads.addAll(services.values());
            boolean axonService = false;
            for (ParcelUuid id : AXON_UUIDS) {
                if ((record.getServiceUuids() != null && record.getServiceUuids().contains(id))
                    || (services != null && services.containsKey(id))) { axonService = true; break; }
            }
            String label = NativeAlertMatcher.match(record.getManufacturerSpecificData(0x034d), axonService, payloads);
            if (label == null) return;
            String id = hash(result.getDevice().getAddress());
            Long previous = alertedDevices.get(id);
            if (!NativeAlertMatcher.canAlert(now, lastNativeAlertAt, previous)) return;
            boolean silent = !getSharedPreferences("patrol_alerts", MODE_PRIVATE).getBoolean("sound", true);
            if (PoliceAlertNotifications.show(this, "Police gear may be nearby", label, false, silent)) {
                alertedDevices.put(id, now); lastNativeAlertAt = now;
                // Prune once per notification; no unbounded per-device history.
                alertedDevices.entrySet().removeIf(e -> now - e.getValue() >= 600_000L);
            }
        } catch (Exception ignored) { /* Unavailable payload or notification permissions must not interrupt BLE scanning. */ }
    }

    private String hash(String addr) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        md.update(salt); md.update(addr.getBytes(StandardCharsets.UTF_8));
        return "n" + hex(md.digest()).substring(0, 16);
    }
    private static String hex(byte[] b) { if (b == null) return ""; StringBuilder sb = new StringBuilder(); for (byte x : b) sb.append(String.format("%02x", x)); return sb.toString(); }
    private void emitState(String st, String d) { Sink s = sink; if (s != null) s.onState(st, d); }

    /** Screen off on Android 8.1+ blocks unfiltered scans, so fall back to the police hardware filters until it is back on. */
    private boolean effectiveFiltered() { return reqFiltered || (!screenOn && Build.VERSION.SDK_INT >= 27); }

    @SuppressLint("MissingPermission")
    private void stopBleOnly() {
        try { if (scanner != null && callback != null) scanner.stopScan(callback); } catch (Exception ignored) { }
        scanner = null; callback = null;
    }
    private void scanFailed(int code) {
        boolean restart = health.pendingRestart;
        stopBleOnly(); running = false; nativeRatePerMin = 0; quiet = false;
        health.failed(code, SystemClock.elapsedRealtime());
        if (restart) failedRestarts++;
        // Keep listeners during bounded retries, but stop the service and reset the UI when
        // the failure cannot be recovered automatically. Do not display an active scanner.
        emitHealth();
        if (health.retryAt > 0) {
            emitState("restart-failed", "Scan failed (code " + code + "); retry scheduled");
        } else {
            emitState("error", "Bluetooth scan stopped (code " + code + "). Tap Start to retry.");
            stopSelf();
        }
    }
    private boolean attemptStart(String why) {
        if (!ScanHealth.canStart(starts, SystemClock.elapsedRealtime())) return false;
        health.started(why);
        try { startScan(reqMode, effectiveFiltered(), reqCids, reqUuids); }
        catch (Exception e) { scanFailed(0); return false; }
        return true;
    }
    /** BLE-only attempts preserve salt, Wi-Fi and wake lock; callbacks alone confirm recovery. */
    private boolean restartBle(String why) {
        if (!ScanHealth.canStart(starts, SystemClock.elapsedRealtime())) return false;
        stopBleOnly(); running = false;
        if ("stall".equals(why)) restartsStall++;
        else if ("periodic".equals(why)) restartsPeriodic++;
        else if ("screen".equals(why)) restartsScreen++;
        emitState("restart", why + " · attempt");
        boolean started = attemptStart(why);
        emitHealth();
        return started;
    }
    private final Runnable tick = new Runnable() { @Override public void run() {
        if (!supervising) return;
        long now = SystemClock.elapsedRealtime();
        if ("failed".equals(health.state)) {
            if (health.retryDue(now)) restartBle("failure");
        } else if (!running || requestedFilterMismatch()) {
            // One supervisor task coalesces transitions using the latest screen state.
            restartBle(running ? "screen" : "initial");
        } else {
            boolean fullWindow = now - windowStart >= 60_000L;
            double rate = windowCount * 60_000.0 / Math.max(1, now - windowStart);
            nativeRatePerMin = rate;
            long age = now - Math.max(lastAdvertAt, lastStartAt);
            boolean stalled = !activeFiltered && screenOn &&
                (age >= NO_CALLBACK_STALL_MS || (fullWindow && isStalled(age, rate, baselinePerMin)));
            if (fullWindow) {
                if (!activeFiltered && screenOn && rate > 0) baselinePerMin = baselinePerMin == 0 ? rate : Math.max(rate, baselinePerMin * 0.8 + rate * 0.2);
                windowStart = now; windowCount = 0;
            }
            if (health.canRestartSilent()) {
                if (stalled) restartBle("stall");
                else if (now - lastStartAt >= PERIODIC_RESTART_MS) restartBle("periodic");
            } else if (stalled && !quiet) {
                quiet = true;
                emitState("quiet", "No native adverts received. The area may be quiet; automatic silence restarts are paused.");
            }
        }
        emitHealth();
        handler.postDelayed(this, WATCHDOG_TICK_MS);
    } };
    private boolean requestedFilterMismatch() {
        boolean hasFilters = (reqCids != null && reqCids.length > 0) || (reqUuids != null && reqUuids.length > 0);
        return ScanHealth.filtered(reqFiltered, screenOn, Build.VERSION.SDK_INT, hasFilters) != activeFiltered;
    }
    private void registerScreen() {
        if (screenRx != null) return;
        screenRx = new BroadcastReceiver() { @Override public void onReceive(Context c, Intent i) {
            boolean on = Intent.ACTION_SCREEN_ON.equals(i.getAction()); if (on == screenOn) return;
            long now = SystemClock.elapsedRealtime();
            if (on && screenOffSince > 0) { screenOffTotalMs += now - screenOffSince; screenOffSince = 0; } else if (!on) screenOffSince = now;
            screenOn = on; emitState(on ? "screen-on" : "screen-off", "");
            if (running && requestedFilterMismatch()) restartBle("screen");
            // If throttled, the single periodic tick retries the latest desired mode.
            emitHealth();
        } };
        IntentFilter f = new IntentFilter(); f.addAction(Intent.ACTION_SCREEN_ON); f.addAction(Intent.ACTION_SCREEN_OFF);
        registerReceiver(screenRx, f);
    }
    /** Counts and coarse device class only: no model name, serial, address or other identifier. */
    private void emitHealth() {
        try {
            JSONObject h = new JSONObject();
            JSONObject r = new JSONObject(); r.put("stall", restartsStall); r.put("periodic", restartsPeriodic); r.put("screen", restartsScreen); r.put("failed", failedRestarts);
            h.put("scanRestarts", r);
            long now = SystemClock.elapsedRealtime();
            h.put("nativeCallbacks", health.callbacks);
            h.put("nativeCallbacksPerMin", Math.round(nativeRatePerMin));
            h.put("lastCallbackAgeMs", health.lastCallbackAt < 0 ? JSONObject.NULL : now - health.lastCallbackAt);
            h.put("scanState", health.state); h.put("lastRestartReason", health.reason); h.put("lastRestartResult", health.result);
            h.put("scanFailureCode", health.failureCode); h.put("requestedFiltered", reqFiltered);
            long off = screenOffTotalMs + (screenOffSince > 0 ? SystemClock.elapsedRealtime() - screenOffSince : 0);
            h.put("screenOffSec", off / 1000); h.put("screenOn", screenOn); h.put("filteredNow", activeFiltered); h.put("quiet", quiet);
            h.put("baselinePerMin", Math.round(baselinePerMin));
            JSONObject a = new JSONObject(); a.put("sdk", Build.VERSION.SDK_INT); a.put("release", Build.VERSION.RELEASE);
            a.put("deviceClass", Build.VERSION.SDK_INT < 27 ? "android-8.0-or-older" : Build.VERSION.SDK_INT < 31 ? "android-8.1-11" : "android-12-plus");
            h.put("android", a);
            emitState("health", h.toString());
        } catch (Exception ignored) { }
    }

    @SuppressLint("MissingPermission")
    private void stopScan() {
        supervising = false; health.stopped();
        stopBleOnly();
        handler.removeCallbacksAndMessages(null);
        if (screenRx != null) { try { unregisterReceiver(screenRx); } catch (Exception ignored) { } screenRx = null; }
        if (wifi != null) { wifi.stop(); wifi = null; }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null; running = false; sessionActive = false;
        alertedDevices.clear(); lastNativeAlertAt = -45_000L;
    }

    @Override public void onDestroy() { stopScan(); salt = null; emitState("stopped", ""); super.onDestroy(); }
}
