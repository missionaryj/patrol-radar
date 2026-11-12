package io.github.missionaryj.patrolradar;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PatrolScanPlugin.class);
        // Optional native SDK build: no static reference in standard APKs.
        try {
            Class<?> nav = Class.forName("io.github.missionaryj.patrolradar.MapboxNavPlugin");
            registerPlugin(nav.asSubclass(com.getcapacitor.Plugin.class));
        } catch (ClassNotFoundException ignored) { /* Native SDK not included in this build. */ }
        super.onCreate(savedInstanceState);
    }
    @Override public void onResume() { super.onResume(); ScanService.setUiForeground(true); }
    @Override public void onPause() { ScanService.setUiForeground(false); super.onPause(); }
}
