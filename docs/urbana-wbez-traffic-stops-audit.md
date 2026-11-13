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
