# Patrol Radar Android app

The Android app wraps the v2 map in Capacitor and adds a **native, passive BLE scanner** that runs in a
foreground service, so scanning keeps going with the screen off or the phone in a pocket.

**Download (always the latest build):**
https://github.com/missionaryj/patrol-radar/releases/download/android-latest/patrol-radar-debug.apk

## Install
1. On the phone, open the link above in Chrome and download `patrol-radar-debug.apk`.
2. Open it. Android asks to allow installs from Chrome ("Install unknown apps"): tap **Settings → Allow from this source**, go back, tap **Install**.
3. If Play Protect warns about an unknown developer, tap **More details → Install anyway** (it is a debug build, not from the Play Store).
4. Updates: download the link again and install over the top. Your saved data stays.

## First run
1. Open **Patrol Radar**. The backend is set to **Android app (background)** automatically.
2. Tap **Scan** and allow: **Nearby devices** (Bluetooth scan), **Location** ("While using the app"; used for your own map dot and the coarse grid of saved hits), and **Notifications** (Android 13+, for the "scanning" notification).
3. Settings → **Let it run in the background** and choose **Allow** / "Unrestricted" battery use.
   - Samsung: Settings → Apps → Patrol Radar → Battery → **Unrestricted**, and remove it from "Sleeping apps".
   - Xiaomi/Redmi/POCO: App info → **Autostart on**, Battery saver → **No restrictions**; lock the app in Recents.
   - OnePlus/Oppo/Realme: Battery → **Allow background activity**.
4. Pick a scan mode in Settings: **Battery saver**, **Balanced** (default) or **Fastest**.

## Field use
1. Open the app, tap **Scan**. A "Patrol Radar is scanning" notification appears; that means the scan service is running.
2. Optionally tap **● Record** to keep a session of police-gear matches.
3. Lock the screen and pocket the phone. Don't swipe the app away from Recents (that can stop it on some phones).
4. Afterwards, open the app: matches show on the map. **■ Stop rec → Export** for the recorder file. Tap **Stop** to end scanning (the notification disappears).

"Devices: Police gear only" (default) uses hardware scan filters for the police signatures; this is what keeps working with the
screen off. "All devices" scans everything but Android pauses unfiltered scans while the screen is off.

## Privacy (unchanged from the web version)
- Passive only: `startScan` only. No connect, pair, bond or write; the app does not even request BLUETOOTH_CONNECT.
- MAC addresses are hashed with a random per-session salt inside the native service; the MAC never reaches the web layer or storage. The JS layer then applies the usual per-session salted hash.
- Unmatched devices are hidden by default; the recorder keeps matches only; saved locations are snapped to the coarse grid.
- Nothing is uploaded. INTERNET is used only for map tiles. Storage is the same localStorage the web version uses (plus the scan-mode choice).
- `neverForLocation` is not used: it makes Android drop beacon-style adverts, and the app asks for location for the map anyway.

## Known limits
- Untested on a real phone so far.
- Aggressive OEM battery managers (Samsung, Xiaomi, Huawei, OnePlus) can still kill the service; use the settings above.
- Android allows ~5 scan starts per 30 s; toggling Scan quickly gives "Scan failed (code 6)". Wait 30 s.
- Low-power mode reports less often; some phones batch results while the screen is off, so hits can arrive late.
- The map UI runs in a WebView; with the screen off Android may slow the page down. The native scan keeps running; if hits look delayed, open the app to catch up.
- The scan has a 6-hour wake-lock cap per session; start it again after that.

## Building locally
```
npm ci && npm run build && npx cap sync android
cd android && ./gradlew assembleDebug   # needs JDK 21 and ANDROID_HOME
```
