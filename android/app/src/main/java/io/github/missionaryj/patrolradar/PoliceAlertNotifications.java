package io.github.missionaryj.patrolradar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/** One notification path for native background detections and the optional JS bridge. */
final class PoliceAlertNotifications {
    static boolean show(Context ctx, String title, String text, boolean soft, boolean silent) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            return false;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        String channel = silent ? "police_ping_silent" : soft ? "police_ping_soft" : "police_ping";
        Uri sound = Uri.parse("android.resource://" + ctx.getPackageName() + "/" + R.raw.police_ping);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(channel) == null) {
            NotificationChannel c = new NotificationChannel(channel,
                silent ? "Silent police ping" : soft ? "Fixed camera ping" : "Police ping",
                soft ? NotificationManager.IMPORTANCE_DEFAULT : NotificationManager.IMPORTANCE_HIGH);
            if (silent) c.setSound(null, null);
            else c.setSound(sound, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            nm.createNotificationChannel(c);
        }
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 1, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_alert).setContentTitle(title).setContentText(text)
            .setAutoCancel(true).setContentIntent(pi).setSilent(silent)
            .setPriority(soft ? NotificationCompat.PRIORITY_DEFAULT : NotificationCompat.PRIORITY_HIGH);
        if (!silent) builder.setSound(sound);
        Notification notification = builder.build();
        try { nm.notify(2001, notification); return true; }
        catch (SecurityException e) { return false; }
    }
}
