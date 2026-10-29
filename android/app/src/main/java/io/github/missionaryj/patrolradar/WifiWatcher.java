package io.github.missionaryj.patrolradar;

import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * PASSIVE Wi-Fi watcher: reads WifiManager scan results only. Never connects, joins, or probes a network.
 * SSIDs/BSSIDs are matched here against rule patterns from the web layer and then discarded: only the
 * matched rule ids, RSSI and a per-session salted hash leave this class. Nothing is written to disk.
 *
 * Throttling (Android 9+): foreground apps get 4 startScan() calls per 2 minutes, background apps 1 per
 * 30 minutes. We request at most one scan every SCAN_INTERVAL_MS (30 s = 4 per 2 min), treat a false return
 * as "throttled" and keep using results from scans the system or other apps run (SCAN_RESULTS_AVAILABLE).
 */
public class WifiWatcher {
    public interface Out { void onMatch(JSONObject m); }
    static final long SCAN_INTERVAL_MS = 30_000;
    static final class Rule { final String id; final Pattern ssid; final String[] ouis; Rule(String id, Pattern p, String[] o) { this.id = id; ssid = p; ouis = o; } }

    private final Context ctx; private final List<Rule> rules; private final Out out; private final HashFn hash;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Map<String, Long> lastEmit = new HashMap<>();
    private long lastSeenTs = 0; private boolean running; private int throttled;
    interface HashFn { String apply(String s) throws Exception; }

    WifiWatcher(Context ctx, JSONArray rulesJson, HashFn hash, Out out) {
        this.ctx = ctx.getApplicationContext(); this.hash = hash; this.out = out; this.rules = parse(rulesJson);
    }
    static List<Rule> parse(JSONArray a) {
        List<Rule> r = new ArrayList<>(); if (a == null) return r;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i); if (o == null) continue;
            String src = o.optString("ssid", ""); Pattern p = src.isEmpty() ? null : Pattern.compile(src, o.optString("flags", "").contains("i") ? Pattern.CASE_INSENSITIVE : 0);
            JSONArray ou = o.optJSONArray("ouis"); String[] ouis = new String[ou == null ? 0 : ou.length()];
            for (int k = 0; k < ouis.length; k++) ouis[k] = ou.optString(k).toUpperCase();
            r.add(new Rule(o.optString("id"), p, ouis));
        }
        return r;
    }
    /** Pure matcher (unit-testable): returns matched rule ids; SSID/BSSID are not retained. */
    static List<String> match(List<Rule> rules, String ssid, String bssid) {
        List<String> ids = new ArrayList<>();
        String oui = bssid == null ? "" : bssid.toUpperCase().replace('-', ':');
        if (oui.length() >= 8) oui = oui.substring(0, 8);
        for (Rule r : rules) {
            boolean hit = r.ssid != null && ssid != null && !ssid.isEmpty() && r.ssid.matcher(ssid).find();
            for (String o : r.ouis) if (o.equals(oui)) hit = true;
            if (hit) ids.add(r.id);
        }
        return ids;
    }

    private final BroadcastReceiver rx = new BroadcastReceiver() { @Override public void onReceive(Context c, Intent i) { read(); } };
    private final Runnable tick = new Runnable() { @Override public void run() { if (!running) return; request(); h.postDelayed(this, SCAN_INTERVAL_MS); } };

    void start() {
        if (running || rules.isEmpty()) return; running = true;
        if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(rx, new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION), Context.RECEIVER_NOT_EXPORTED);
        else ctx.registerReceiver(rx, new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION));
        read(); h.post(tick);
    }
    void stop() { running = false; h.removeCallbacksAndMessages(null); try { ctx.unregisterReceiver(rx); } catch (Exception ignored) { } lastEmit.clear(); }

    @SuppressWarnings("deprecation")
    private void request() {
        WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
        if (wm == null) return;
        try { if (!wm.startScan()) throttled++; } catch (SecurityException e) { throttled++; }
    }
    @SuppressLint("MissingPermission")
    private void read() {
        WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
        if (wm == null || !running) return;
        List<ScanResult> rs; try { rs = wm.getScanResults(); } catch (SecurityException e) { return; }
        if (rs == null) return;
        long newest = lastSeenTs; long nowUs = SystemClock.elapsedRealtime() * 1000;
        for (ScanResult r : rs) {
            if (r.timestamp <= lastSeenTs || nowUs - r.timestamp > 120_000_000L) continue; // only fresh results
            newest = Math.max(newest, r.timestamp);
            @SuppressWarnings("deprecation") String ssid = r.SSID;
            List<String> ids = match(rules, ssid, r.BSSID);
            if (ids.isEmpty()) continue;
            try {
                String key = hash.apply("wifi:" + r.BSSID);
                Long prev = lastEmit.get(key); long now = System.currentTimeMillis();
                if (prev != null && now - prev < 10_000) continue;
                lastEmit.put(key, now);
                JSONObject o = new JSONObject(); o.put("id", key); o.put("rssi", r.level); o.put("rules", new JSONArray(ids)); o.put("throttled", throttled);
                out.onMatch(o); // ssid/bssid deliberately not included
            } catch (Exception ignored) { }
        }
        lastSeenTs = newest;
    }
}
