package io.github.missionaryj.patrolradar;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/** Bridge between the web UI and ScanService. Passive scan only. */
@CapacitorPlugin(name = "PatrolScan", permissions = {
    @Permission(alias = "ble", strings = { Manifest.permission.BLUETOOTH_SCAN }),
    @Permission(alias = "legacyBle", strings = { Manifest.permission.ACCESS_FINE_LOCATION }),
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
})
public class PatrolScanPlugin extends Plugin {

    @Override public void load() {
        ScanService.sink = new ScanService.Sink() {
            @Override public void onAdvert(JSONObject a) {
                try { notifyListeners("advert", JSObject.fromJSONObject(a)); } catch (Exception ignored) { }
            }
            @Override public void onState(String st, String d) { JSObject o = new JSObject(); o.put("state", st); o.put("detail", d); notifyListeners("state", o); }
        };
    }

    private String[] aliases() {
        List<String> a = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) a.add("ble"); else a.add("legacyBle"); // Android 11 and older need location to scan
        a.add("location"); // for the user's own map position (display only)
        if (Build.VERSION.SDK_INT >= 33) a.add("notifications");
        return a.toArray(new String[0]);
    }
    private JSObject result() {
        JSObject r = new JSObject();
        PermissionState ble = Build.VERSION.SDK_INT >= 31 ? getPermissionState("ble") : getPermissionState("legacyBle");
        r.put("ble", ble.toString());
        r.put("location", getPermissionState("location").toString());
        r.put("notifications", Build.VERSION.SDK_INT >= 33 ? getPermissionState("notifications").toString() : "granted");
        return r;
    }

    @PluginMethod public void requestScanPermissions(PluginCall call) {
        boolean need = false;
        for (String a : aliases()) if (getPermissionState(a) != PermissionState.GRANTED) need = true;
        if (!need) { call.resolve(result()); return; }
        requestPermissionForAliases(aliases(), call, "permsCallback");
    }
    @PermissionCallback private void permsCallback(PluginCall call) { call.resolve(result()); }

    @PluginMethod public void start(PluginCall call) {
        String mode = call.getString("mode", "balanced");
        boolean filtered = call.getBoolean("filtered", true);
        int[] cids = new int[0]; String[] uuids = new String[0];
        try {
            JSArray c = call.getArray("companyIds", new JSArray());
            cids = new int[c.length()]; for (int i = 0; i < c.length(); i++) cids[i] = c.getInt(i);
            JSArray u = call.getArray("serviceUuids", new JSArray());
            uuids = new String[u.length()]; for (int i = 0; i < u.length(); i++) uuids[i] = u.getString(i);
        } catch (Exception e) { call.reject("bad filters"); return; }
        try { ScanService.start(getContext(), mode, filtered, cids, uuids); call.resolve(); }
        catch (Exception e) { call.reject("Could not start background scan: " + e.getMessage()); }
    }
    @PluginMethod public void stop(PluginCall call) { ScanService.stop(getContext()); call.resolve(); }
    @PluginMethod public void status(PluginCall call) { JSObject r = result(); r.put("running", ScanService.running); call.resolve(r); }

    /** Opens the system dialog to exempt the app from battery optimisation (user choice). */
    @PluginMethod public void openBatterySettings(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        JSObject r = new JSObject();
        boolean ignoring = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        r.put("ignoring", ignoring);
        if (!ignoring) {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { getContext().startActivity(i); } catch (Exception e) { getContext().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        }
        call.resolve(r);
    }
}
