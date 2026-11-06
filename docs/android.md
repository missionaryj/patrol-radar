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

## Police ping
A short two-tone ping (`public/sounds/police-ping.*`, original, synthesized) plays when a NEW police-gear match first appears:
once per device per session, once per ~150 m cell per 10 min, and at most once every 45 s. Fixed cameras (Flock/Raven) get a
softer ping. Phones/consumer devices never ping. Toggle: Settings → "Police ping sound" (saved in localStorage, default on).
With the app in the background the web layer asks the plugin to post a "Police ping" notification that uses
`res/raw/police_ping.ogg` on its own channel (users can change/mute it in Android notification settings). This depends on the
WebView still receiving adverts while backgrounded; if Android suspends the WebView, no ping fires until the app is reopened.

## Scan supervisor

Field test 2026-11-04 (older Android phone, lowLatency, all devices): BLE adverts ran ~400/min for ~6 min after each start,
then fell to 0-16/min while the scan was still on. `ScanService` now supervises the scan:

- **Stall restart**: with an unfiltered scan and the screen on, no callback for 45 s, or the last minute's rate below 10% of the
  baseline (baseline >= 60/min), stops and restarts the BLE scan (same salt, so hashes stay stable).
- **Periodic restart** every 4 min, as some Android 7-11 stacks quietly stop delivering.
- **Start-rate guard**: at most 3 `startScan` calls per 30 s (Android refuses the 6th).
- **Screen off** (Android 8.1+ blocks unfiltered scans): switches to the police hardware filters (company IDs incl. Axon,
  service UUIDs incl. 0xFC81) until the screen is back on, then returns to all devices.
- **Bounded silence recovery**: at most 3 stall/periodic restarts without a native callback. After that,
  silence-triggered restarts pause until callbacks resume (or the user starts a new session). Silence can mean a quiet
  RF environment, especially with filters; it is not evidence of broken hardware. Screen transitions remain available.
- **Async failures**: codes 2, 3, 5 and 6 permit at most 3 retries per callback-free outage, after 31/62/93 seconds,
  also subject to the start-rate guard. Other codes, exhausted retry budgets, and synchronous exceptions stop the native scan service and tell the UI scanning has ended; the user can tap Start again.
  Retryable failures retain bridge listeners so recovery can reach the UI. No automatic release is performed during PR checks.
- Screen transitions are coalesced by one 15-second supervisor tick when throttled. The latest requested mode wins.
  Stopped/old scan callbacks are ignored. Stop/destruction removes all pending tasks, receiver and wake lock.
- Foreground service + partial wake lock (6 h cap) as before.

Debug file `health`: `scanRestarts {stall, periodic, screen, failed}`, `screenOffSec`, `android {sdk, release, deviceClass}`
(version class only, no model or identifiers), events `screen-off` / `screen-on` / `auto-restart` / `scanner-quiet`.


### Diagnostic semantics and field validation (Issue #18)

`scanRestarts` keeps its existing keys; stall/periodic/screen count **attempts**, not confirmed recoveries, and failed
counts failed restart attempts (initial-start failures are represented by scan state/code). The `restart` event is an
attempt; `recovered` requires a real result from the current native scan. A normal return from Android `startScan`
only means `starting`. `receiving` means at least one callback was received, not guaranteed continuous RF activity.

Additional aggregate fields are allowlisted by the bridge and exported under `health.nativeSupervisor`:
- `nativeCallbacks`: result count for this service session, including each batched result and callbacks while the
  WebView sink is detached. Native counting happens before payload processing. BLE-only restarts do not reset it.
- `nativeCallbacksPerMin`: latest watchdog sample of the current window's rate (up to 60 seconds); zero before the
  first sample or on failure. `lastCallbackAgeMs`: monotonic age since the last real result, null before any result.
- `scanState`: stopped / starting / receiving / failed; `lastRestartReason`: none / stall / periodic / screen / failure;
  `lastRestartResult`: none / pending / failed / recovered. A screen change can supersede a pending attempt.
- `scanFailureCode`: most recent Android failure code, retained after recovery; 0 means none or a synchronous start
  exception (use `scanState` to distinguish). `requestedFiltered` is the user preference. Existing `filteredNow` is
  the actual nonempty hardware filter mode of the last successfully submitted scan; consult `scanState` on failure.

No addresses, raw payloads, SSIDs, GPS, device identifiers or model names enter these fields. JS/recorder advert
counts can be lower than native callback counts when the UI is suspended. Neither count measures detection accuracy.

On-device validation remains necessary:
1. Run 10+ minutes screen-on with all devices/unfiltered. Record callback count/rate/age, 4-minute attempts, and
   callback-confirmed recoveries. Compare counts before and after each attempt without interpreting volume as accuracy.
2. Run 10+ minutes screen-off. Confirm filtered fallback, stable foreground service, and native counts after returning
   to the UI. A filtered scan may legitimately have zero callbacks.
3. Toggle screen off/on rapidly across the 3-starts/30-second limit. Verify eventual mode matches the latest screen
   state, without duplicate streams or repeated queued restart tasks.
4. Background/foreground the UI, including WebView detachment. Verify native counts continue and recovery is based
   on callbacks even when no sink is attached. Check exported diagnostic fields after resuming.
5. In a quiet area, verify automatic silence restarts stop after three. Inject Android scan failures (especially 6)
   in a test build: verify failed state, bounded delayed retries, and no recovery event until callbacks resume.
6. Repeat Start/Stop and destroy the service; verify no callbacks/retries continue, receiver is unregistered and wake
   lock is released. BLE-only restarts should retain the per-session salt; a new user session should replace it.

Pure native state tests live in `ScanHealthTest`; run `cd android && ./gradlew testDebugUnitTest` with the Android SDK
and Java 21 installed. The helper has no Android dependencies and can also be compiled/run with JUnit 4 alone.
