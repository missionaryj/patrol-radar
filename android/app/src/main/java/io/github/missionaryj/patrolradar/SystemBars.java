package io.github.missionaryj.patrolradar;

import android.app.Activity;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/** Status and navigation bar colors for the saved appearance choice. */
public final class SystemBars {
    public static final String PREFS = "pr.theme";
    private static final int LIGHT = Color.parseColor("#F4F6F8");
    private static final int DARK = Color.parseColor("#07080A");

    private SystemBars() {}

    public static void saveChoice(Context ctx, String choice) {
        if (!"light".equals(choice) && !"dark".equals(choice)) choice = "system";
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("choice", choice).apply();
    }

    public static String choice(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("choice", "system");
    }

    public static boolean light(Activity activity, String choice) {
        if ("light".equals(choice)) return true;
        if ("dark".equals(choice)) return false;
        int night = activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return night != Configuration.UI_MODE_NIGHT_YES;
    }

    /** Paint bars and the window behind them. `light` is the resolved appearance, not the saved choice. */
    public static void paint(Activity activity, boolean light) {
        if (activity == null) return;
        Window w = activity.getWindow();
        int color = light ? LIGHT : DARK;
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(color);
        w.setNavigationBarColor(color);
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
        View decor = w.getDecorView();
        decor.setBackgroundColor(color);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(w, decor);
        if (bars != null) {
            bars.setAppearanceLightStatusBars(light);
            bars.setAppearanceLightNavigationBars(light);
        }
        if (activity instanceof BridgeActivity) {
            BridgeActivity bridgeActivity = (BridgeActivity) activity;
            if (bridgeActivity.getBridge() != null) {
                WebView web = bridgeActivity.getBridge().getWebView();
                if (web != null) web.setBackgroundColor(color);
            }
        }
    }
}
