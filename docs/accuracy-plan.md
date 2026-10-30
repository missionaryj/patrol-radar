# Accuracy plan (v0.2)

> Note (Oct 2026): the radio dispatch/incident layer described in parts of this plan was removed from the app; those sections are historical.

## Current state
- **BLE (`src/ble`):** the scanner has two backends, mock and Web Bluetooth.
  - `signatures.ts` holds 7 rules, all unverified.
  - `matcher.ts` combines independent hits with 1−Π(1−c) and gives a small penalty when RSSI is below −90.
  - Device IDs are reduced to a salted hash that changes every session.
- **Map (`src/map`):** Leaflet with a ~150 m grid. BLE circles fade out over 15 minutes.
- **Reports (`src/reports`):** stored in localStorage. The backend interface is a stub.

## BLE accuracy improvements
1. **Signature validation.** Collect real captures with the user's consent. Hash the payload, not the device. Promote a rule to `field-validated` only after N independent sightings, and track a precision estimate for each rule.
2. **RSSI smoothing.** Apply an EMA or a Kalman filter per session ID. Require at least 2 adverts within 10 s before alerting. Show only a proximity band (near / medium / far). Never show distance, because RSSI is a poor estimator of it.
3. **Co-occurrence grouping.** When two or more distinct police-type categories (camera + CEW + radio or router) appear within 60 s and within a similar RSSI band, report a "likely vehicle" group with higher confidence.
4. **Confidence model.** Combine the rule prior, the number of distinct rules hit, persistence (seconds seen), the RSSI trend and co-occurrence. Calibrate the result against field data with logistic regression.
5. **False positives.**
   - Down-weight shared company IDs, such as Motorola consumer products.
   - Keep a user "ignore" list of session hashes. It is ephemeral.
   - Suppress devices that follow the user for more than 30 minutes, since that is probably their own gear or a neighbour's.
   - Allow an opt-in report of "this was wrong".
6. **iOS.** CoreBluetooth never exposes MAC addresses, so OUI or prefix rules can't work there. Rely on the company ID, service UUIDs, service data and names.

## Radio pipeline (design)
```
source → STT → parser(scrub) → geocoder → coarsen → merge → privacy filter (delay) → publish
```
- **Source:** your own SDR (rtl-sdr + trunk-recorder, which records per-talkgroup calls), or a licensed or permitted feed.
- **STT:** whisper.cpp or faster-whisper running locally, with a domain prompt (street names, codes). Audio and transcripts are deleted as soon as parsing finishes.
- **Parser (`parser.ts`):**
  - `scrub()` runs first and removes units, badges and ranked names.
  - Regexes then extract the call type (from a 10-code map that can be configured per agency, or from keywords), the address or intersection, and the status.
- **Geocoder:**
  - Nominatim: max 1 request/s, a real User-Agent, caching, and no bulk use. Its usage policy forbids heavy use.
  - For volume, run a self-hosted Nominatim or Pelias.
  - Always bound queries to the feed's county bbox (`viewbox` + `bounded=1`).
- **Merge (`incidentMerger.ts`):**
  - Events are merged by grid cell + call type + a 30-minute window.
  - `dispatched` contributes most of the confidence. `onscene` only raises confidence and the timestamp. It never creates a "police are here now" pin.
  - Incidents expire after 2 windows.
- **Privacy (`privacy.ts`):**
  - The grid is clamped to 150–250 m.
  - `publishable()` enforces a delay of at least 10 minutes (default 12) before anything is shared.
  - Unit numbers, names and badges are never stored.

## Challenges
- **Legal audio.**
  - Broadcastify's terms forbid scraping, rebroadcasting or re-streaming without a commercial license, and its APIs go through the Developer Program.
  - The OpenMHz API is for its own clients only, unless you get permission.
  - Your own SDR is the cleanest path. Follow state scanner laws (some restrict scanners in vehicles) and never decrypt anything.
- **STT errors.** Radio audio is narrowband and clipped, with squelch tails and jargon. Expect a high word error rate on numbers and street names. Validate against a street-name gazetteer and require the geocoder's confidence to be at or above a threshold.
- **10-codes vary by agency.** Maintain a map for each feed. Many agencies use plain language instead.
- **Spoken addresses.** Expect hundred blocks ("the 1200 block of Clark"), cross streets, landmarks, and partial or corrected addresses. Add a "block of" pattern and landmark lookup.
- **Noise.** Drop transmissions under N words, with no location, or that are only acknowledgements ("copy", "10-4"). Deduplicate repeated broadcasts.
- **Passive and legal.** The system is receive-only: no transmitting, jamming or decryption. Incidents describe call type + area only, never unit positions. This is not legal advice.

## Next steps
1. Add a "block of" pattern and a per-feed config (10-codes, county bbox, street gazetteer).
2. Build a whisper.cpp harness that runs on the user's own SDR recordings and is tested against a synthetic audio fixture.
3. Add a real Nominatim geocoder with cache, rate limiting and bbox.
4. Add BLE RSSI smoothing, persistence gating and co-occurrence grouping, with unit tests.
5. Add a field-validation logging mode (opt-in, payload hashes only).
6. Design the shared backend: k-anonymity (show a cell only after reports from at least N distinct sources), the delay, and no per-device history.
