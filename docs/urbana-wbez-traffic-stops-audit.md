# Urbana Police traffic-stop file audit — 2026-11-13

**Status: genuine Illinois Traffic Stop Study source identified, but NOT added to published map until agency-specific historic polygons, source rights, and identity audit are verified.** This is separate from the investigatory/pedestrian Stop Sheet [excluded in an earlier audit](urbana-stop-sheet-audit.md).

## Uploaded WBEZ source — privacy-safe verification

- Upload name: `URBANA POLICE.csv` (user supplied); **17 MB**, 97 columns. The file includes driver demographic, ZIP, vehicle, and search-related fields. **Never commit/publish the source CSV or these personal fields.**
- SHA-256: `ac810a5982057de5fb71ecd31f550266659acecc0b41da2155ffdf1f125b499b`.
- Reporting agency: `URBANA POLICE`, agency code `13100` on all **60,229 rows**.
- Years: **2004–2022**, 19 annual periods. All have parseable date and a non-empty `BeatLocationOfStop`; one has missing/invalid time. No latitude/longitude source fields.
- `id` and `record_ref` each have 60,229 distinct row values. **These are publisher/derived row identifiers; uniqueness of row IDs cannot prove real-world stop uniqueness.** 37 excess rows share an identical combination of date, time, location code, reason, moving-violation type, and outcome; these are **potential** duplicates, not proven repeated encounters, because unrelated stops can share these fields.
- **400 distinct location codes** across all years. The code scheme changes materially:
  - 2004–2006: **10,615 rows with 4-character codes**.
  - 2007–2020: **48,020 rows with 5-character codes**.
  - 2021: 280 rows with 2-character codes and 48 with 5-character codes.
  - 2022: 1,314 rows with 2-character codes and 7 with 5-character codes. Two-character codes are `61`–`65`; seven five-character rows use `99999` (unknown). Across all years, `99999` occurs 193 times and must not be mapped.
  - Individual codes are *not coordinates*; never parse `54711` or `54606` as latitude or longitude or join them to Champaign police beats.
- The [Urbana public-safety operational assessment](https://checkcu.org/wp-content/uploads/documents-Articles/Urbana-Illinois-BerryDunn-Report-Public-Safety-Services-Operational-Review-Assessment-March-2024.pdf) includes an agency-provided **2021 police beat map** for the five precinct/beat areas 61–65. This supports the new two-character labels, but the PDF map alone does not provide audited GIS polygon coordinates. Historically, an [Urbana policing task-force report](https://www.urbanaillinois.us/sites/default/files/attachments/task-force-final-report-vol-i-main-report-ver151222_2.pdf) describes approximately 140 city geocodes (within five beats), with different accuracy and coverage from 150 m GPS cells. These still require the *correct effective-year polygons*.
- [WBEZ Urbana police stop explorer](https://interactive.wbez.org/traffic-stops/urbana-police/) documents its Illinois IDOT data; the source CSV is the user-provided department-only version. WBEZ's MIT *analysis-code* license does not establish the commercial licence of its republished stop records.

### Annual source-row counts (not deduplicated, not mapped)

| Year | Rows | Year | Rows | Year | Rows |
|---:|---:|---:|---:|---:|---:|
| 2004 | 3,545 | 2011 | 2,830 | 2018 | 3,513 |
| 2005 | 3,055 | 2012 | 3,751 | 2019 | 3,243 |
| 2006 | 4,015 | 2013 | 4,294 | 2020 | 1,410 |
| 2007 | 3,381 | 2014 | 4,205 | 2021 | 328 |
| 2008 | 4,025 | 2015 | 3,659 | 2022 | 1,321 |
| 2009 | 4,277 | 2016 | 3,310 | | |
| 2010 | 3,079 | 2017 | 2,988 | | |

The [2019 UPD report](https://www.urbanaillinois.us/sites/default/files/attachments/UPD%20Traffic%20Stops%20-%202019%20Final.pdf) reports 35,038 stops across 2010–2019. The uploaded WBEZ subset for the same ten years is **34,872**, 166 fewer; that difference is an audit question, not a reason to artificially add stops or substitute unverified totals. The 2021 and 2022 year totals are unusually low compared with earlier years and must not be read as complete reporting without external confirmation.

## Current engineering outcome

- **Accepted for public stop heat map: 0** pending coordinate/agency-geocode verification, source reuse rights, and event-level deduplication audit.
- **Available as a verified, research-only source file: 60,229 reported rows** (not 60,229 validated unique encounters).
- **No 150 m cells** may be rendered because this file contains no source stop coordinates. If effective-year geocode polygons are acquired, visualize a labelled **coarse agency-geocode choropleth**; do not present it as point-cell coverage or fill whole jurisdictions as though all roads had observations.
- This candidate overlaps other Urbana/IDOT/OPP sources; any eventual import must identify its publisher/year/agency ownership, not sum overlapping releases.
- Source file stays outside Git checkout/public outputs. A privacy-minimized **annual counts only** user artifact was produced locally; no personal fields or 5-digit location-level aggregates are committed.

## Immediately actionable next step

A request was **emailed to `PoliceFrontDesk@urbanail.gov` on 2026-11-13** for historic geocode GIS polygons/lookup tables (2004–2020), 2021–2022 beat 61–65 boundary geometries, effective years, and commercial reuse conditions. Await agency response. In parallel check the [City of Urbana GIS portal](https://www.urbanail.gov/public-works/page/maps-and-gis) and available 2021 beat map for properly published GIS layers. Do not infer GIS coordinates from a static PDF image or reuse **Champaign** polygons.

Once verified, develop a distinct agency-geocode adapter (not coordinate fake data), reconcile source counts, and add deterministic validation/tests. Keep PR #49 a draft until reviewed. No merge, Alpha upload, or production release was done.

## Independent continuation audit — 2026-11-13

The original `/mnt/data` attachment is not mounted in the Windows continuation. WBEZ's [department download](https://drive.google.com/file/d/1A4PjkwvioJ2d05KOs8V5wCigFub1jmXZ/edit), linked by its Urbana explorer, was independently downloaded outside the checkout. Its 17,000,579 bytes have exactly the upload SHA-256 above. This verifies byte identity with the audited upload, not official certification of individual encounters. No source CSV or person-level fields were committed.

`node scripts/urbana-staging.mjs /absolute/path/outside-checkout/URBANA.csv` reproduces the privacy-minimized [aggregate audit](urbana-staging-audit.json). It checks the exact checksum before parsing, allowlists only audit fields, suppresses CSV error values, and refuses source files inside the checkout. It is a **research-only staging adapter**, not a public choropleth importer: no geometry, stop events, centroids, cells, or location-level counts are exported. Its format classification is not geographic validation. There is deliberately no activation switch or trusted-boolean bypass.

Rerun results: all 60,229 dates parse as full civil dates and match the source year; all rows identify Urbana agency 13100; 60,229 distinct values occur in each publisher-row identifier column. One time fails strict 24-hour clock validation. The six-field duplicate screen produces **36 groups and 37 excess rows**; the same excess persists when including all allowlisted non-identifier audit fields. No rows were deleted. Resolving these needs official encounter identifiers or publisher lineage, not demographic matching. Publisher `id`/`record_ref` uniqueness does not resolve event identity. No independently certified unique-stop count is available.

There are 193 `99999` unknown-location rows. Excluding those from scheme counts yields 10,615 four-digit historical rows, 47,781 five-digit historical rows, 1,594 modern-beat rows, and **46 unresolved mixed-era rows**. These categories sum to 60,229. The 46 are non-unknown five-digit rows in 2021; do not discard digits or assume their relationship to beats 61–65. Neither adding a prefix to old codes nor taking a prefix of newer codes establishes a crosswalk.

The [2019 official report](https://www.urbanaillinois.us/sites/default/files/attachments/UPD%20Traffic%20Stops%20-%202019%20Final.pdf), Figure 1, page 4, gives annual totals. Official minus CSV differences are: 2010 +20; 2011 +79; 2012 +26; 2013 +19; 2014 +5; 2015 +4; 2016 +6; 2017 +3; 2018 +2; 2019 +2. These sum to **166**, with every source-year count below the report. This localizes but does not explain the discrepancy. The report describes ARMS extraction at stop, violation, or person level, normally using the stop as analysis unit; WBEZ describes state IDOT submissions. Revised submissions, extraction rules, or omissions remain hypotheses. Candidate deduplication would reduce CSV counts further, so it cannot fill the shortfall. Do not invent 166 events or rescale counts. The WBEZ documentation describes a statewide 2004–2023 release; this checksum-identified Urbana file ends in 2022, so neither 2023 nor complete annual reporting is established by this file.

### Boundary and rights investigation

The [official City GIS page](https://www.urbanail.gov/public-works/page/maps-and-gis) links `maps.urbanail.gov/portalwebadaptor`. Although browser retrieval timed out, the public REST interface was reachable. Searches on 2026-11-13 for `police` returned seven items (including unrelated federated content), and `beat` returned zero. Police results included **Police Department Residency Buffer**, not patrol areas. The [PoliceDepartment service folder](https://maps.urbanail.gov/serverwebadaptor/rest/services/PoliceDepartment?f=pjson) lists only Residency Buffer FeatureServer/MapServer services. A `geocode` search also returns an address locator and unrelated federated results; address geocoding is not the historical police statistical geography. Search absence does not prove the agency lacks private or archived boundaries. No matching historical polygon release, effective-date schedule, CRS/codebook, or four-digit/five-digit/beat crosswalk was acquired. The 2021 PDF beat map supports labels only; it cannot certify 2022 validity or GIS coordinates. No Champaign layer or traced PDF geometry was used.

The [WBEZ technical documentation](https://docs.google.com/document/d/1Yk1J9SAPfZXfYk2Kb-z6K4p4eU6Rhnoc0RciRscymgY/edit) was readable through its text export. It describes state-derived compilation and requests a backlink and notification for use, but no explicit commercial data license was located there. This is not a conclusion that reuse is unlawful; sufficient source-specific permission has not been established for this product. Separately, the [City website copyright notice](https://www.urbanail.gov/home-page/page/website-disclaimer-accessibility-statement) requires written permission for commercial use of its site materials. That notice must not be treated as a license for WBEZ data or all IDOT public records. Obtain separate applicable terms for the data and boundaries; the analysis-code MIT license is insufficient.

### Exact promotion blockers and next actions

1. Await the already-sent Urbana request; obtain genuine polygons for each historical validity interval, official code definitions, effective dates and crosswalks (including 2021 mixed codes), CRS, attribution and reuse terms. Verify geometry validity, agency identity and unambiguous date/code matches before any aggregation. Do not duplicate the request now.
2. Await the already-sent IDOT request; reconcile official encounter identity, revisions, the annual differences above, late-year completeness and overlapping releases. For duplicate candidates, request confirmation/lineage without publishing private records.
3. Establish applicable written commercial reuse terms for both source records and boundaries. Then implement a separate coarse choropleth with unmatched/unknown exclusions, boundary checksums, effective-date tests, overlap ownership, replay and count reconciliation. No conversion into the 150 m point-cell pipeline.

**Coverage after this work:** Urbana mapped records 0; Urbana occupied 150 m cells 0; Illinois accepted source counties 0/102 (0%), with 87/102 still the interim county target. Illinois occupied-cell footprint is 0; statewide geographic, road and population completeness have not been established. The existing broader snapshot is unchanged. No whole-beat polygon area is credited as observed stop coverage.

Local validation: 340 tests across 46 files pass; TypeScript and web build pass. A separate read-only PR CI workflow now covers scripts and this staging adapter without deployment or release steps. Source CSV stays outside the repository; only aggregate JSON is versioned. PR #49 remains draft; no merge, Alpha or production publication is authorized.
