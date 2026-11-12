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

Official event IDs merge repeated violation/contact rows. Citation/warning/arrest flags are ORed; inconsistent reason categories become unknown. If a valid event ID conflicts on date, time or location, every valid row of that event is quarantined. Distinct event IDs at identical coordinates/times remain distinct. Every source reconciles:

`source rows = accepted records + duplicate rows collapsed + rejected rows`.

OPP archive `raw_row_number` is only a publisher-row identity. Where OPP performed raw-field deduplication, this adapter preserves that result but cannot independently establish encounter uniqueness. **Total accepted records are not a verified nationwide unique-encounter count.** No rounding, coordinate fingerprint or guessed identity is used to manufacture a unique-stop claim. Census polygon membership validates geographic plausibility, not ground-truth geocoding accuracy.

## Snapshot: 2026-11-12

8,000,903 source rows produced **5,860,229 accepted records**, with **832,309 duplicate rows collapsed** and **1,308,365 rejected rows**. New-source records total **2,435,848**. The previous manifest counted 7,252,795 input rows as stops; the new total is 1,392,566 lower after validation, deduplication and quarantining unsupported legacy imports. This is a quality correction, not a net-count growth claim.

- Montana OPP: 921,228 read; 920,370 accepted; 858 rejected; no repeated publisher row keys. 2009–2017, state patrol only.
- Vermont OPP: 283,285 read; 261,621 accepted; 21,664 rejected; no repeated publisher row keys. 2010–2015, state police only.
- San Francisco OPP: 905,070 read; 898,737 accepted; 6,333 rejected; no repeated publisher row keys. 2007–2016.
- Cincinnati: 750,258 read; 355,120 accepted; 368 duplicates collapsed; 394,770 rejected. Publisher-reported dates 1990-09-21 through 2026-11-11; early dates are not independently corroborated and the range does not imply continuous reporting.
- NYPD: 2,971,075 read; 2,309,224 accepted; 661,851 rejected. 2023-01-01 through 2026-06-30. Anonymized coordinates; command codes are officer assignments and are **not** location joins.
- Montgomery: 2,169,987 violation rows read; 1,115,157 accepted stop IDs; 831,941 additional violation rows collapsed; 222,889 rejected. 2012-01-01 through 2026-11-10. Only explicitly known motor-vehicle categories 01–27 are accepted; other/unknown and electric-bicycle rows are excluded. The source exposes 1,239,349 distinct IDs before date/geographic validation; that is not the accepted count.

Exact rejection reasons, source/date metadata, all acquisition checksums and Census boundary URLs/checksums are in `public/data/stop-heat/index.json`. Public tiles contain only aggregate buckets, outcome/reason categories and source counts.

Chicago's previous 2,108,098 rows are withheld: OPP explicitly warns of unresolved duplicates and hourly time resolution. Urbana's previous 5,446 rows are withheld pending event identity and correct Urbana geometry; the old pipeline joined Urbana to Champaign beats. They remain named in `notMapped`, not silently counted. Unvalidated state/local overlaps are also excluded: no Cincinnati OPP plus official contact cards, no statewide NC plus its municipal subsets, and no overlapping CA RIPA/local/OPP years.

## Objective coverage

**Six states have records:** CA, MD, MT, NY, OH and VT, out of 50 states plus DC. This is presence, not complete statewide coverage. Illinois is no longer included in the audited map until its quarantined sources are repaired.

The six disjoint source jurisdictions contain **12,776,835 residents** in the 2020 Census, against a U.S. population of 331,449,281. This is agency-jurisdiction context, **not** the number/share of residents observed or protected, nor full local-agency coverage of Montana/Vermont.

There are **163,060 occupied 150 m cells**. Their spherical area, clipped to the union of Census jurisdiction polygons, is approximately **3,654.242 km²**, or **0.03710169%** of the 50-state-plus-DC area of 9,849,259.424 km² (land plus water). Cells are counted once across sources. The footprint measures coarse cells containing geographically plausible publisher coordinates; it is not road-network coverage, land-only coverage, surveyed stop-location accuracy, or the area of entire shaded jurisdictions. Point observations themselves have zero area. Do not count beats, bounding boxes, whole states, reporting-agency addresses or all jurisdiction residents as observed coverage. The 75% goal has **not** been reached under any defensible nationwide measure.

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
