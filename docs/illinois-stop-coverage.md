# Illinois historical stop coverage — expansion work (2026-11-13)

Tracker: [#55](https://github.com/missionaryj/patrol-radar/issues/55). Parent draft: [PR #49](https://github.com/missionaryj/patrol-radar/pull/49).

**Status: Chicago and Urbana are in the 2026-11-14 audited snapshot, with the limits below.** Do not use the older `main` heat-map totals as the audited baseline. `main` mapped 2,005,974 Chicago OPP rows with no encounter dedupe, and 4,739 Urbana investigatory-sheet rows onto Champaign beats. Both of those treatments stay retired.

Measured on this snapshot:

| City | Before this repair (PR #49 snapshot) | `main` (retired) | Accepted now | Years | Geography |
| --- | ---: | ---: | ---: | --- | --- |
| Chicago | 0 | 2,005,974 mapped of 2,108,098 rows | **1,877,250** of 2,108,098, after 28,222 identical rows collapsed and 202,626 rejected | 2012-01-01 through 2020-05-16 | 150 m cells inside the 2020 Chicago city boundary |
| Urbana | 0 | 4,739 of the investigatory sheet | **28,241** of 28,425 stop-level rows; 24 duplicate incidents collapsed; 160 unknown `999-99` rejected | 2013-01-01 through 2023-02-14 | One Urbana city polygon. 0 cells. Not Champaign |

## Illinois source leads

| Priority | Publisher / source | Verified evidence | Import blocker |
| --- | --- | --- | --- |
| 1 | IDOT 2025 traffic-stop study | [Official 2025 Part I](https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/reports/safety/traffic-stop-studies/2025-traffic-stops-part-i.pdf) reports 775 agencies contributing vehicle-stop data (752 compliant, 23 incomplete); about 2.06M stops | Underlying event-level files are not included in this PR; IDOT requires a data request; agency-defined beats do not supply latitude/longitude |
| 1 | WBEZ / Investigative Project on Race and Equity | [Interactive](https://interactive.wbez.org/traffic-stops/illinois-statewide/) links statewide archive (Big Local News) and full SQLite database (Google Drive); reporters analyzed ~42.5M records across 2004–2023 | Acquire authorized copy; confirm downloadable access, event identity, geographic schema, data licensing for paid use and overlapping years |
| 2 | City of Chicago current police-beat layer | [Official Chicago polygons, dataset aerh-rz74](https://data.cityofchicago.org/d/aerh-rz74), maintained as current beat boundaries; based on 2012 beats | Verify correct historical versions, IDs and stop-agency/beat matches before linking Chicago source years |
| 2 | Chicago OPP historical stop file | [Pinned archive](https://stacks.stanford.edu/file/druid:wb225bk3255/wb225bk3255_il_chicago_2023_01_26.csv.zip), SHA-256 `d7c671d3fa0f03ae07900b39753f1d9c1decbe3131b4736b1ff720a7dd6fabea`, ODC-BY | **Imported.** Vehicle rows only, clipped to the 2020 Chicago city boundary. Identical public stop attributes collapse. Residual duplicates can remain because many times are hourly and officer ids are incomplete. Not a certified unique-stop count |
| 2 | Urbana stop-level traffic stops | [data.illinois.gov 5r4s-jwyk](https://data.illinois.gov/d/5r4s-jwyk), public download, no registration. Portal policy [20 ILCS 45/15](https://www.ilga.gov/legislation/ilcs/documents/002000450K15.htm) | **Imported as a citywide shade.** Incident-number key. No coordinates in the file. Public GIS has no beat polygons, so counts sit on the Urbana city boundary and are not 150 m cells or Champaign beats. 2023 is not a certified full year |
| 2 | Urbana investigatory / pedestrian Stop Sheets | [Illinois Open Data dataset vnxf-tjw4](https://data.illinois.gov/d/vnxf-tjw4); uploaded 5,446-row CSV audited on 2026-11-13 | **EXCLUDED**: person-level sheet, including `MOTOR VEHICLE NON-IVC`. See [upload audit](urbana-stop-sheet-audit.md). Never join to Champaign beats |
| 2 | Urbana offense-level traffic stops | [data.illinois.gov vzjr-d62i](https://data.illinois.gov/d/vzjr-d62i) | **EXCLUDED**: same stops as `5r4s-jwyk` at offense grain. Not summed |
| 2 | WBEZ Urbana department extract | Checksum-pinned research file, 60,229 rows, 2004–2022 | **EXCLUDED**: no coordinates, no public beat polygons, and no explicit commercial data license. Official stop-level file used instead |
| 3 | Springfield Police original government data | [Police transparency ArcGIS](https://maps.springfield.il.us/server/rest/services/SPD/SPD_Transparency/FeatureServer), [SPD police-beat service](https://maps.springfield.il.us/server/rest/services/SPD/Beat/FeatureServer), [IDOT annual tables](https://idot.illinois.gov/form-and-reports/crash-reports/illinois-traffic-and-pedestrian-stop-study.html) | Free official sources located, but **no confirmed downloadable vehicle-stop event layer or validated historical beat polygons**. City commercial FOIA may take 21 business days and charge fees; prioritize free public data, see [Springfield audit](springfield-government-data-audit.md) |
| 3 | Evanston, Aurora, Rockford, Peoria, Metro East, etc. | Discovery candidates, not validated downloads | Audit official data portals, stop vs person/violation unit, date windows and geographic precision before adding any counts |

**Urbana WBEZ traffic-stop dataset now acquired for offline audit (2026-11-13):** 60,229 reported source rows spanning 2004–2022; 400 distinct agency location codes. Unlike the earlier uploaded investigatory Stop Sheet, this is a traffic-stop dataset. However the fields contain **no verified latitude/longitude**; geocode formats changed (four-digit through 2006, five-digit through 2020, then mainly beat IDs 61–65 in 2021–2022). Counts cannot be turned into the 150 m point-cell map without agency-specific effective-year polygons; licence and independent encounter uniqueness are also not yet verified. The new [privacy-safe source audit](urbana-wbez-traffic-stops-audit.md) documents the file SHA-256, annual counts and blockers. That extract is not the published layer. The published layer is the official stop-level file, shaded on the Urbana city boundary.

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

1. Await the already-sent IDOT request for a privacy-minimized 2024–2025 extract. Do not duplicate it. Reconcile the 2025 stop-count discrepancy against official event data.
2. Obtain a lawful copy of the WBEZ/IPRE release and its data dictionary; identify agency, stop ID, date and beat fields and verify data reuse terms before ingestion.
3. Chicago is restored by the identical-attribute key above, not by re-enabling every OPP row. Urbana is the official stop-level file on the city boundary. Finer Urbana geocode polygons are still unpublished.
4. Create source-specific adapters and fixture tests using the existing PR #49 fail-closed pipeline. Calculate exact county and occupied-cell coverage after real records exist. Preserve PR #49 as a draft and do not publish or merge without a separate review.

### Original IDOT request text — request already sent

Subject: Illinois Traffic Stop Study data request, 2024–2025 (non-identifying event fields)

Please provide, if maintained and releasable, machine-readable 2024 and 2025 statewide traffic-stop data, limited to the fields necessary to count and geographically aggregate vehicle stops: stop date and time, reporting agency code, source event/stop identifier (if available), agency-defined stop beat/location code, stop reason and outcome. Please also provide the codebook, data dictionary, agency-code list, beat-code definitions or boundary references, a statement of incomplete/missing reporting agencies, and any conditions on public/commercial reuse. We do **not** request driver/officer identities, driver address, license plate, birth information, or demographic fields. Please indicate whether the source records support reliable location assignment and whether revised/corrected annual snapshots are available.

The 2026-11-13 continuation left the WBEZ extract research-only: 60,229 source rows, 37 candidate duplicate excess rows, 193 unknown locations, one invalid time, and the 166-row 2010–2019 shortfall still unexplained. That extract is still not published. The 2026-11-14 snapshot instead uses the public Urbana stop-level file as a city shade and the deduplicated Chicago OPP file as 150 m cells. Those are the accepted Illinois records in the table above. They are not statewide coverage and not 85% of Illinois.
