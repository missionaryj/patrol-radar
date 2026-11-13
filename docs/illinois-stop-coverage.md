# Illinois historical stop coverage — expansion work (2026-11-13)

Tracker: [#55](https://github.com/missionaryj/patrol-radar/issues/55). Parent draft: [PR #49](https://github.com/missionaryj/patrol-radar/pull/49).

**Status: research and map-matching safety only. No new Illinois records have been accepted or published.**
The PR #49 audited snapshot has no verified Illinois stop footprint. Do not use the older `main` heat-map totals as the audited baseline.

## Illinois source leads

| Priority | Publisher / source | Verified evidence | Import blocker |
| --- | --- | --- | --- |
| 1 | IDOT 2025 traffic-stop study | [Official 2025 Part I](https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/reports/safety/traffic-stop-studies/2025-traffic-stops-part-i.pdf) reports 775 agencies contributing vehicle-stop data (752 compliant, 23 incomplete); about 2.06M stops | Underlying event-level files are not included in this PR; IDOT requires a data request; agency-defined beats do not supply latitude/longitude |
| 1 | WBEZ / Investigative Project on Race and Equity | [Interactive](https://interactive.wbez.org/traffic-stops/illinois-statewide/) links statewide archive (Big Local News) and full SQLite database (Google Drive); reporters analyzed ~42.5M records across 2004–2023 | Acquire authorized copy; confirm downloadable access, event identity, geographic schema, data licensing for paid use and overlapping years |
| 2 | City of Chicago current police-beat layer | [Official Chicago polygons, dataset aerh-rz74](https://data.cityofchicago.org/d/aerh-rz74), maintained as current beat boundaries; based on 2012 beats | Verify correct historical versions, IDs and stop-agency/beat matches before linking Chicago source years |
| 2 | Chicago OPP historical stop file | Previously 2,108,098 rows considered; now quarantined in PR #49 | Publisher documents unresolved duplicate records and hourly time resolution; no unsupported unique encounter claim |
| 2 | Urbana investigatory / pedestrian Stop Sheets | [Illinois Open Data dataset vnxf-tjw4](https://data.illinois.gov/d/vnxf-tjw4); uploaded 5,446-row CSV audited on 2026-11-13 | **EXCLUDE FROM IVC TRAFFIC STOP HEAT MAP**: only 1,420 `MOTOR VEHICLE NON-IVC` person rows; not ordinary traffic stops; see [upload audit](urbana-stop-sheet-audit.md). Never join to Champaign beats. Find the separate Urbana Police Traffic Stops dataset |
| 3 | Evanston, Aurora, Rockford, Peoria, Springfield, Metro East, etc. | Discovery candidates, not validated downloads | Audit official data portals, stop vs person/violation unit, date windows and geographic precision before adding any counts |

**IDOT count discrepancy to reconcile before exact-count claims:** The 2025 executive summary's Key Findings says **2,062,235** traffic stops, whereas the report introduction/how-analyzed section says **2,062,325**. Both numbers occur in the same report; do not silently pick one as validated ground truth. The reported **76.4% agency completion** is a proportion of agencies in the reporting universe, **not** a map-area or counties-covered share.

IDOT [study landing page](https://idot.illinois.gov/form-and-reports/crash-reports/illinois-traffic-and-pedestrian-stop-study.html) explicitly directs event-level data requests to **DOT.ITPSS@illinois.gov**, to be forwarded to its FOIA officer. The [2024 traffic-stop data format](https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/pamphlets---brochures/safety/trafficstopdbfileformat.pdf) uses a police-agency-defined beat field rather than mandatory GPS coordinates. This does **not** support publishing guessed coordinates for a state-wide heat map.

**WBEZ access/licensing note:** The published [analysis repository](https://github.com/wbez/traffic_stops) has an MIT code license, but that **does not imply the separate stop database has an MIT license**. Big Local News / Google Drive access and the reuse rights of the data must be independently confirmed, particularly for Pro. The full database link currently surfaces Google sign-in when opened without an authenticated session.

## What “85%” means

Track independent metrics with explicit denominators; do not conflate them:

1. **State geographic occupied-cell footprint (primary)**: union area of audited, valid 150 m stop cells, clipped to Illinois boundaries, divided by Illinois **land area** from a fixed official Census release. This is still not road-network coverage, nor a prediction of police presence. Observed individual stop points have zero mathematical area.
2. **County source availability (interim target)**: Illinois has 102 counties; target **87 counties with at least one accepted, non-overlapping, location-qualified stop source** (87 / 102 = 85.3%). This is not 85% geographic area and does not imply all agencies in a county reported. County sums must be deduplicated.
3. **Agency reporting completeness**: share of eligible agencies with full-year source records by year, with omissions recorded explicitly.
4. **Population context**: population of uniquely covered source jurisdictions divided by Illinois population; not street accuracy.

Every published percentage must label its metric, year window, denominator, precision tier, and whether it measures source availability or actual mapped observations.

## Fail-closed Illinois import requirements

- Event-level **motor-vehicle** stops only; no pedestrians, calls for service, mugshots, arrest logs, crash incidents, or person/violation rows inflated into stops.
- Explicit source, reporting agency, calendar date, stable event ID (when available), and source-year ownership. Quarantine conflicting IDs and document identity uncertainty when unique IDs do not exist.
- Where a source has coordinates, check validity and official Illinois/agency polygon membership; snap only verified coordinates to the established privacy grid.
- Where only a beat code is provided, match a documented **agency-specific** police-beat polygon and effective date. Do not match unscoped or other-city beats, invent centroid points, or count a whole county as occupied area.
- The build must not retain or publish names, addresses, plates, birth dates, demographic or officer identifiers. Source archives stay outside the repository and build outputs.
- Reconcile accepted, duplicate and rejected records and preserve source attribution, licence checks, checksums, offline replay, and historical geographic limitations. Never append one isolated source's tiles to a prior complete snapshot.
- Confirm commercial reuse of every external dataset before delivering it as part of paid features. Distinguish an agency-beat choropleth from point-cell shading.

## Safe next execution steps

1. Acquire a privacy-minimized IDOT 2024–2025 extract through the official records channel (a request draft follows; **no request sent**). Reconcile the 2025 stop-count discrepancy against official event data.
2. Obtain a lawful copy of the WBEZ/IPRE release and its data dictionary; identify agency, stop ID, date and beat fields and verify data reuse terms before ingestion.
3. Restore Chicago only after deduplication audit and historical police-beat mapping; rebuild Urbana only with its own source identifiers and genuine Urbana geography.
4. Create source-specific adapters and fixture tests using the existing PR #49 fail-closed pipeline. Calculate exact county and occupied-cell coverage after real records exist. Preserve PR #49 as a draft and do not publish or merge without a separate review.

### Prepared request to IDOT — not sent

Subject: Illinois Traffic Stop Study data request, 2024–2025 (non-identifying event fields)

Please provide, if maintained and releasable, machine-readable 2024 and 2025 statewide traffic-stop data, limited to the fields necessary to count and geographically aggregate vehicle stops: stop date and time, reporting agency code, source event/stop identifier (if available), agency-defined stop beat/location code, stop reason and outcome. Please also provide the codebook, data dictionary, agency-code list, beat-code definitions or boundary references, a statement of incomplete/missing reporting agencies, and any conditions on public/commercial reuse. We do **not** request driver/officer identities, driver address, license plate, birth information, or demographic fields. Please indicate whether the source records support reliable location assignment and whether revised/corrected annual snapshots are available.
