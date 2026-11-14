package io.github.missionaryj.patrolradar;

import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean lastNight;
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PatrolScanPlugin.class);
        // Optional native SDK build: no static reference in standard APKs.
        try {
            Class<?> nav = Class.forName("io.github.missionaryj.patrolradar.MapboxNavPlugin");
            registerPlugin(nav.asSubclass(com.getcapacitor.Plugin.class));
        } catch (ClassNotFoundException ignored) { /* Native SDK not included in this build. */ }
        super.onCreate(savedInstanceState);
        boolean light = SystemBars.light(this, SystemBars.choice(this));
        int night = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        lastNight = night == Configuration.UI_MODE_NIGHT_YES;
        SystemBars.paint(this, light);
    }
    @Override public void onResume() { super.onResume(); ScanService.setUiForeground(true); }
    @Override public void onPause() { ScanService.setUiForeground(false); super.onPause(); }
    /** uiMode is handled here so a system dark-mode change does not recreate the scan UI. */
    @Override public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        boolean night = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        if (night == lastNight) return;
        lastNight = night;
        String choice = SystemBars.choice(this);
        if ("light".equals(choice) || "dark".equals(choice)) return;
        SystemBars.paint(this, !night);
        if (getBridge() == null) return;
        WebView web = getBridge().getWebView();
        if (web != null) web.post(() -> web.evaluateJavascript("window.__prThemeSync&&window.__prThemeSync(" + night + ")", null));
    }
}
