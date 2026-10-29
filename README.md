# Patrol Radar (passive, receive-only prototype)

A modular Vite + TypeScript web app (PWA-friendly, so it can be wrapped with Capacitor for Android later). It listens **passively** for Bluetooth Low Energy advertisements from public-safety equipment, such as Axon body cameras and TASERs, and plots your own detections on a coarse, time-decaying OpenStreetMap map.

**Android app:** background scanning with the screen off. [Download APK](https://github.com/missionaryj/patrol-radar/releases/download/android-latest/patrol-radar-debug.apk), see [docs/android.md](docs/android.md).

## Quick start
```bash
npm install
npm run dev     # open the printed URL; Mock backend is the default
npm run build
```
Mock mode sends simulated advertisements, including non-matching "noise", every 1.5 s. The demo points are scattered around your coarse location, or around Chicago if geolocation is denied.

### Real BLE (experimental)
- Use Chrome on Android or desktop over HTTPS or localhost, and enable `chrome://flags/#enable-experimental-web-platform-features`. That turns on `navigator.bluetooth.requestLEScan`, which scans continuously.
- Without the flag, the app falls back to `requestDevice({acceptAllDevices})` plus `watchAdvertisements()`. That only watches **one device you pick by hand**, so it is a demo rather than a detector.
- iOS Safari has no Web Bluetooth. For reliable background scanning you need a native wrapper (Capacitor + a BLE plugin).

## Architecture
```
src/ble/       Scanner interface, MockScanner, WebBluetoothScanner, signatures.ts (data-driven), matcher.ts
src/map/       Leaflet MapView (decay rendering), coarsen() ~150 m grid
src/reports/   Report type, LocalReportStore (localStorage, 15 min TTL), ReportBackend interface + NotImplementedBackend
src/util/      ephemeralId(): salted per-session SHA-256 → 8 hex chars
docs/          scanner-streams.md
```
`match(adv)` returns `{signature, confidence, rssi, timestamp, sessionId}`. Independent hits are fused with 1−Π(1−c). Every signature is flagged **"unverified, needs field validation"**.

## Passive-only and privacy design
- **Receive-only.** The app never connects, pairs, reads or writes GATT, or probes devices.
- MACs, device IDs, and serials are never stored or shown. Only a salted hash is kept, and the salt changes every page load.
- Locations are rounded to about 150 m. Detections fade out and expire after 15 minutes, and nothing leaves the device.
- Any future shared or crowdsourced map **must** aggregate, coarsen, and delay data before showing it. It must not identify or track individual officers, and it must not keep a persistent device history.

## Legal notes (not legal advice)
- In the US, federal law generally allows receiving unencrypted public radio. Some states restrict scanners in vehicles or their use while committing a crime. Check your local law.
- Passively receiving BLE advertisements is receive-only, but laws and terms vary by place.
- Don't interfere, jam, spoof, decrypt, or interact with any device or radio system. Doing so may be illegal and is out of scope for this project.
- Third-party feeds such as Broadcastify and OpenMHz have restrictive terms. See [docs/scanner-streams.md](docs/scanner-streams.md).

## Limitations
- BLE range is short, typically tens of meters and up to about 100 m in ideal conditions.
- Web Bluetooth scanning sits behind a flag and is Chrome-only. There is no iOS support.
- Many agencies encrypt their radios, and much equipment doesn't advertise or uses randomized addresses.
- False positives happen: vendor company IDs are shared with civilian products, and the signatures are unverified.
- App stores may restrict or reject apps like this.

## Responsible use
This tool is for awareness and research. It must not be used to harass, follow, target, obstruct, or endanger officers or anyone else. Don't build features that identify or track individuals.

## Prior art
[RF Sentinel](https://github.com/CIS-C0/RFSentinel) is an open-source Android app that passively detects body cams, ALPRs, and similar devices over BLE and Wi-Fi, and groups signals into patrol vehicles. Its public signature list informed `signatures.ts`.

## iPhone options (research, not implemented)
- **Bluefy browser:** it doesn't implement `requestLEScan`. It has its own `bluetooth.watchAdvertisements(options)` (added in v3.8.2), which you turn on with Settings → "Enable BLE Advertisements". Supporting it would mean adding a small extra scanner backend. Pages must be served over HTTPS.
- **Capacitor iOS + `@capacitor-community/bluetooth-le`:** `BleClient.requestLEScan` uses CoreBluetooth. In the foreground it reports the local name, manufacturer data, service UUIDs, service data and signal strength (RSSI), but never the MAC address. iOS also needs a `dataPrefix` in manufacturer-data filters.
  - Background scanning requires `UIBackgroundModes: bluetooth-central` plus a service-UUID filter. It is throttled, gives only one event per device, and the plugin can't resume a scan after iOS suspends the app.
  - To build it you need a Mac with Xcode. A free Apple ID can sideload the app onto your own phone, but the signature expires after 7 days. A paid account ($99/yr) is needed for TestFlight or the App Store.

## Radio incidents (prototype, mock only)
`src/radio` parses dispatch transcripts into **incidents**: a call type plus a coarse area. It never tracks units or officers.
- Unit IDs, badge numbers and names are scrubbed out before any other processing.
- Locations are snapped to a 150–250 m grid.
- Shared output must wait at least 10 minutes (default 12) before it is published.
- An "on scene" status only raises an incident's confidence. It never becomes a separate pin.

Tick "Mock radio incidents" to see the demo layer. See `docs/accuracy-plan.md`. Run the tests with `npm test`.

## Shared crowd map (opt-in)
v2 Settings → "Share police-gear hits to the crowd map" (off by default). Uploads only `{cell (~200 m grid), bucket (5 min), kind, conf (low/med/high), reporter (random per-session token)}` to `https://patrol-radar-api.vercel.app/api/crowd` (source in `crowd-api/`, protocol in `src/crowd/protocol.ts`). Public reads are aggregated, ≥12 min delayed, expire after 2 h; a cell is "confirmed" with ≥2 distinct reporters or high confidence. Storage: Upstash Redis if `UPSTASH_REDIS_REST_URL/TOKEN` (or `KV_REST_API_URL/TOKEN`) are set, else ephemeral memory.

## Flock camera (mapped) layer
`public/data/flock/` holds US Flock ALPR nodes from OpenStreetMap (`surveillance:type=ALPR` + `manufacturer`/`brand` ~ Flock, the tags DeFlock.me uses), split into 5° tiles plus `index.json`. Refresh with `node scripts/fetch-flock.mjs` (Overpass API). Data © OpenStreetMap contributors, ODbL 1.0.
