# Historical stop heat — audited import

This map is historical, regional, visual-only shading. It does not show current police activity, identify people, or predict enforcement. Publisher coordinates may be anonymized or inaccurate. A 150 m display grid is **not** a claim of 150 m source accuracy.

## Rebuild and review

Use Node 20+ and `npm ci`. Windows uses the bundled `tar`; Linux/macOS require `unzip` for ZIP archives. Install `csv-parse` and `polygon-clipping` from the lockfile, not ad hoc processing scripts.

```sh
node scripts/build-verified-stop-heat.mjs --cache ../stop-heat-cache --out ../stop-heat-review
node scripts/build-verified-stop-heat.mjs --cache ../stop-heat-cache --out ../stop-heat-replay --offline
# Optional isolated source build; never treat this as an incremental merge:
node scripts/build-verified-stop-heat.mjs --cache ../stop-heat-cache --out ../montgomery-review --only montgomery
```

`scripts/fetch-stop-heat.mjs` is a compatibility entry point to the same audited builder. `--cache` and `--out` are mandatory. Caches must be outside the checkout/output tree: Stanford raw archives can contain personal fields, although parsing discards them. Do not commit, publish or retain raw downloads unnecessarily. Municipal queries request only stop identifiers, dates, roles, coordinates and outcome/reason fields. Anonymous source identifiers stay in memory and are never in public aggregates. No driver identity, demographic attributes, officer information, plate, VIN or address is written to output.

The build downloads at most four pages concurrently per source and parses in order. Live sources require equal publisher revision timestamps and counts before/after retrieval. Each 50,000-row page must have its exact expected row count. Offline replays verify every page checksum and archive SHA-256. Any download, schema, CSV, population or reconciliation failure aborts publication; partially fetched data never replace a working snapshot. Output is staged and swapped after validation, with any old output retained as `.previous`; choose a fresh review path if a stage/backup already exists. There is no release, scheduled upload or production connection.

Review all audit counts, metadata and coverage, compare replayed tile hashes, then explicitly promote the **complete** review directory into `public/data/stop-heat/` in a PR. Raw inputs and caches stay outside that directory. The source index is compactly renumbered for each complete build. Do not append files from a subset build to a full build.

## Validation and counting

The registry is `scripts/stop-heat-sources.mjs`. Vehicle stops require an explicit OPP `vehicular` type, a Cincinnati Driver role, or a vehicle-only official collection. Passengers and pedestrians are excluded. ISO civil dates must exist on the calendar and fall inside the source window and build cutoff. Missing/invalid times are assigned the unknown-time bucket. Coordinates must be finite and inside the source jurisdiction's **2020 Census polygon**, including holes and islands; coordinates outside it are rejected before snapping. Historical jurisdiction changes and legitimate out-of-jurisdiction enforcement can therefore be conservatively excluded.

Official event IDs merge repeated violation/contact rows. Citation/warning/arrest flags are ORed; inconsistent reason categories become unknown. If a valid event ID conflicts on date, time or location, every valid row of that event is quarantined. Distinct event IDs at identical coordinates/times remain distinct.

Chicago OPP does not use `raw_row_number` as an encounter id. That column is unique per extract row, so it cannot collapse the arrest/citation join Stanford describes. The Chicago key is the SHA-256 of the public stop attributes the map can see: date, time, latitude, longitude, type, violation, citation flag, arrest flag, outcome, and beat. Identical keys collapse. A different time, coordinate, violation, or beat stays a separate row, because an hourly geocode can be shared by two vehicles. Personal and officer fields are not part of the key and are not read into it. Stanford's own note still applies after this collapse: many clocks are hourly and officer ids are incomplete, so residual duplicate encounters can remain. The published count is deduplicated source rows, not a certified unique-stop count.

Urbana uses the City of Urbana stop-level traffic-stop table on data.illinois.gov (`5r4s-jwyk`), keyed by incident number. The investigatory stop sheet and the offense-level table are not added. The stop-level file has agency geocodes and no coordinates. The public Urbana GIS services publish a residency buffer, not beat polygons, so accepted stops are shaded on the 2020 Census place boundary for Urbana city. That polygon is not a 150 m cell, not a police beat, and not a Champaign boundary. Its area is not counted in the occupied-cell footprint. The WBEZ department extract is not published: it has no coordinates and no explicit commercial data license.

Every source reconciles:

`source rows = accepted records + duplicate rows collapsed + rejected rows`.

OPP archive `raw_row_number` is only a publisher-row identity. Where OPP performed raw-field deduplication, this adapter preserves that result but cannot independently establish encounter uniqueness. **Total accepted records are not a verified nationwide unique-encounter count.** No rounding, coordinate fingerprint or guessed identity is used to manufacture a unique-stop claim. Census polygon membership validates geographic plausibility, not ground-truth geocoding accuracy.

## Snapshot: 2026-11-14

10,138,257 source rows produced **7,766,114 accepted records**, with **860,801 duplicate rows collapsed** and **1,511,342 rejected rows**. Against the 2026-11-12 snapshot (5,860,229 accepted), this is 1,905,885 more accepted records. Of that increase, **1,905,491** are the restored Illinois sources below. The other **394** are live Cincinnati (+96) and Montgomery (+298) rows that arrived in the publisher snapshots between those builds. OPP archive totals did not change.

- Montana OPP: 921,228 read; 920,370 accepted; 858 rejected; no repeated publisher row keys. 2009-01-01 through 2017-12-31, state patrol only.
- Vermont OPP: 283,285 read; 261,621 accepted; 21,664 rejected; no repeated publisher row keys. 2010-07-01 through 2015-12-31, state police only.
- San Francisco OPP: 905,070 read; 898,737 accepted; 6,333 rejected; no repeated publisher row keys. 2007-01-01 through 2016-06-30.
- Cincinnati: 750,392 read; 355,216 accepted; 369 duplicates collapsed; 394,807 rejected. Publisher-reported dates 1990-09-21 through 2026-11-12; early dates are not independently corroborated and the range does not imply continuous reporting.
- NYPD: 2,971,075 read; 2,309,224 accepted; 661,851 rejected. 2023-01-01 through 2026-06-30. Anonymized coordinates; command codes are officer assignments and are **not** location joins.
- Montgomery: 2,170,684 violation rows read; 1,115,455 accepted stop IDs; 832,186 additional violation rows collapsed; 223,043 rejected. 2012-01-01 through 2026-11-12. Only explicitly known motor-vehicle categories 01–27 are accepted; other/unknown and electric-bicycle rows are excluded.
- Chicago OPP: 2,108,098 read; **1,877,250 accepted**; **28,222 identical-attribute rows collapsed**; 202,626 rejected (105,960 missing coordinates, 87,133 outside the 2020 Chicago city boundary, 9,533 not vehicular). 2012-01-01 through 2020-05-16. On this branch before the repair, accepted Chicago records were 0. The older `main` map counted 2,005,974 of these rows as mapped, with no encounter dedupe. This snapshot does not revive that count. Residual duplicate encounters can remain.
- Urbana stop-level: 28,425 read; **28,241 accepted**; 24 duplicate incident rows collapsed; 160 rejected as unknown location `999-99`. 2013-01-01 through 2023-02-14. Accepted records are one citywide shade, **0** occupied 150 m cells. On this branch before the repair, accepted Urbana records were 0. The older `main` map counted 4,739 investigatory-sheet rows, including joins onto Champaign beats. That layer is not restored.

Exact rejection reasons, source/date metadata, all acquisition checksums and Census boundary URLs/checksums are in `public/data/stop-heat/index.json`. Public tiles contain only aggregate buckets, outcome/reason categories and source counts.

The investigatory Urbana stop sheet, the Urbana offense-level table, and the WBEZ Urbana extract stay in `notMapped`. Unvalidated state/local overlaps are also excluded: no Cincinnati OPP plus official contact cards, no statewide NC plus its municipal subsets, no Illinois statewide OPP on top of Chicago, and no overlapping CA RIPA/local/OPP years.

## Objective coverage

**Seven states have records:** CA, IL, MD, MT, NY, OH and VT, out of 50 states plus DC. This is presence, not complete statewide coverage. Illinois here is Chicago vehicle stops plus a Urbana citywide total. It is not statewide, not 85% of Illinois, and not a count of Illinois counties.

The seven source jurisdictions contain **15,561,559 residents** in the 2020 Census, against a U.S. population of 331,449,281. Chicago city is 2,746,388 of that and Urbana city is 38,336. This is agency-jurisdiction context, **not** the number/share of residents observed or protected, nor full local-agency coverage of Montana, Vermont, or Illinois.

There are **183,115 occupied 150 m cells**. Their spherical area, clipped to the union of Census jurisdiction polygons, is approximately **4,097.703 km²**, or **0.04160417%** of the 50-state-plus-DC area of 9,849,259.424 km² (land plus water). Cells are counted once across sources. Chicago accounts for the new cells. The Urbana city polygon is not part of this footprint. The footprint measures coarse cells containing geographically plausible publisher coordinates; it is not road-network coverage, land-only coverage, surveyed stop-location accuracy, or the area of entire shaded jurisdictions. Point observations themselves have zero area. Do not count beats, bounding boxes, whole states, reporting-agency addresses or all jurisdiction residents as observed coverage. The 75% goal has **not** been reached under any defensible nationwide measure.

## Refresh process

1. Keep pinned OPP archives historical. To replace one, review publisher documentation, set a new version URL/checksum and date window in a PR, then replay it from scratch. An archive download date is not its last stop date.
2. For daily/periodic municipal updates, use a fresh external cache and review output. Reject any source that changes during acquisition; retry a complete snapshot rather than resuming unverified offset pages. Later corrections can change old dates, so rebuild complete selected sources.
3. Inspect exact accepted/excluded/duplicate counts, observed time ranges, coordinate-rejection spikes and event conflicts. Compare per-source/year totals against the prior accepted snapshot; investigate unexpected drift rather than publishing automatically.
4. Replay offline; verify identical tile bytes and coverage/counts (build timestamp and cache fetch metadata can differ). Run `npm test` and `npm run build`. Reconcile all tile bucket/source counts to the manifest. Review provenance, terms and any new overlapping publisher/agency/year range.
5. Open a data-update PR. Human review is the promotion step. No merge, Alpha release, production write, cron publishing or billing change is authorized by this work.

See [the nationwide research ledger](stop-heat-research.md) and [51-jurisdiction discovery inventory](stop-heat-source-inventory.json) for remaining acquisition work. Those leads are not imported coverage.

## Map and Pro limitations

Both map views retain visual-only historical shading, without heatmap tap targets, popups or external links. Source attribution, accepted/excluded counts, time ranges and regional coverage caveats appear in Settings. The location dot stays above the layer; grid cells appear at zoom 11+ with the existing per-view cap. Darker shading reflects record density, not enforcement probability.

This change does not alter the proposed Pro offering, entitlement checks or Google Play Billing. Public aggregate files are not protected paid content. Verify commercial reuse terms (particularly municipal portal terms), attribution, data freshness and subscription/backend delivery separately before any release. No payment, enrollment, merge or release is performed by the import scripts.
