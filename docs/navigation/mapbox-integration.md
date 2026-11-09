# Patrol Radar — Mapbox Navigation integration plan

Status: **provider selected; native SDK not yet integrated**. Do not represent the current navigation destination input as functional until the acceptance checks below pass.

## Architecture
- Keep the existing Capacitor app, BLE supervisor and Flock/traffic-camera/Stop History data pipelines.
- Use Mapbox **Navigation SDK v3 for Android** for active guidance and traffic-aware routing. Its native Android view/guidance must be bridged into the Capacitor application, rather than trying to treat the current MapLibre 3D map as a Mapbox native view.
- Keep Patrol Mode and Navigation Mode as two presentations of the same location/scan session. Avoid duplicate GPS watches, doubled SDK navigation sessions, or rebuilding the native map on every mode switch.
- Use the existing MapLibre/Leaflet Patrol map unless/until a carefully tested migration is justified. Never place a native Android map directly behind a transparent WebView without testing lifecycle, touch handling, and memory on target devices.
- Retain current scanner-status and camera alerts while navigating; avoid intrusive driver interactions.

## Credentials and cost controls
1. Create Mapbox account at https://account.mapbox.com and review https://www.mapbox.com/pricing.
2. Public Mapbox access token (pk.*) for runtime resources. A public token may be embedded in an Android application; restrict scopes and URLs where appropriate.
3. Secret Mapbox Downloads:Read token (sk.*) for Maven dependencies: **GitHub Actions secret**, e.g. `MAPBOX_DOWNLOADS_TOKEN`. Never commit or log it, expose it to web JavaScript, or place it in a generated APK.
4. Do not enable SDK dependency downloads in CI until the secret exists. Keep non-Mapbox PR CI green.
5. Use metered trips to start; monitor account analytics and set billing notifications/budgets. Do not claim alerts are hard spending caps. Trips, MAUs, geocoding/search, tile requests outside sessions, and other API requests can count separately.

## Implementation sequence
1. Wire welcome modes and retain scanner/map instances; write screen/state accessibility tests.
2. Native Android integration: Mapbox Maven auth with env/Gradle properties, SDK v3 pinned to verified release, AppCompat/native lifecycle integration, installable debug build.
3. Capacitor bridge: `startNavigation(destination)`, `previewRoutes`, `selectRoute`, `stopNavigation`, `getNavigationState`; route-progress, arrival, rerouting, errors, and traffic notifications.
4. Place search/geocoding with debounce, cancellation, requests quota controls, recent destinations; request location and background permissions appropriately.
5. Active guidance: preview alternatives, voice, ETA, speed limits only where supplied, highway/lane instructions where data available, map-matched position, rerouting, off-route/weak-GPS handling.
6. Smooth mode switches preserving an active trip and running scanner; 3D first-frame startup without 2D flash. If SDK view cannot coexist smoothly, explicit transition with retained session is acceptable.
7. Offline nav and downloaded maps as separately tested feature, contingent on Mapbox support/entitlements and device storage.
8. QA on physical Android phones: location permission denied, GPS lost, app background/foreground, long trips, Bluetooth scans plus narration, no duplicate trip billing, cold launch, screen rotations, navigation shutdown.

## Acceptance criteria
- Navigation is not labeled complete unless an actual destination can be searched, route started, GPS positions progressed, turns spoken, and rerouting validated on-device.
- Traffic-aware ETA/alternatives and congestion display operate with live Mapbox session data; unavailable traffic is not represented as known.
- Patrol Mode continues BLE alerts and documented camera layers, avoiding false certainty about equipment identification.
- App returns from navigation to Patrol Mode without app restart, leaks, or restarting BLE scanning.
- Run `npm test`, `npm run build`, Android Gradle tests and at least one physical device drive test before release.

Docs: https://docs.mapbox.com/android/navigation/guides/install/ and https://docs.mapbox.com/android/navigation/guides/pricing/
