# Permission & declaration justifications

## Foreground service (Play Console → App content → Foreground service permissions)
Service `.ScanService`, types **connectedDevice** (always) + **location** (only when fine location is granted).
- connectedDevice: "The service performs a user-started, continuous Bluetooth LE scan for nearby public-safety equipment advertisements while the screen is off. Scanning starts only when the user taps Start, shows a persistent notification, and stops on Stop. Interruption would stop detection mid-session." Video: screen-record tapping Start, the notification appearing, locking the screen, and Stop.
- location: "While the user-started scan runs, the service keeps the device's GPS fix so each detection can be placed on a coarse 150–250 m map grid. The precise fix is only shown on screen, never stored or sent."
If review pushes back on two types, drop `location` (keep connectedDevice) — detections would then use the last fix from when the app was visible.

## Location permissions
ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION are foreground ("While using the app") only. **ACCESS_BACKGROUND_LOCATION is not requested**, so no background-location declaration is needed. The foreground service is started from the visible activity, which Android counts as while-in-use.

## Bluetooth
BLUETOOTH_SCAN (Android 12+) without `neverForLocation`, because the app derives map location from scans. BLUETOOTH/BLUETOOTH_ADMIN capped at API 30. No BLUETOOTH_CONNECT (never connects).

## Other
POST_NOTIFICATIONS (foreground-service notification), WAKE_LOCK, INTERNET (map tiles, geocoding, opt-in crowd map).
Removed for Play: REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (restricted permission); the in-app button now opens the system battery-optimization list instead.

## Other App content items
- Ads: No ads. Government app: No. Financial features: None. Health: No. News: No.
- Account deletion: no accounts.
