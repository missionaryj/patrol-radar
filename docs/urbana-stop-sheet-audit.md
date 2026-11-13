# Urbana IDOT Stop Sheet upload audit — 2026-11-13

**Disposition: excluded from PR #49's IVC / routine motor-vehicle traffic-stop heat map. No Urbana events added.**

The user supplied `City_Of_Urbana__IDOT_Stop_Sheet_(Police_Data)_20261113.csv` as a separate upload. It has **51 columns**, some containing identifying and sensitive person fields. **The raw CSV is not committed, not included in build assets, and must not be uploaded into the repository**.

- Local upload SHA-256: `1268f8e9d9733d0a7993fd91f9abdaf760b6d1d4cfa1072de1786d53e1b55a1c`
- Total source rows: **5,446**.
- Source category counts: **3,443 PEDESTRIAN**; **1,420 MOTOR VEHICLE NON-IVC**; **449 BICYCLE**; **134 OTHER**.
- Records with no georeference: **707**, across all types.
- MOTOR VEHICLE NON-IVC subset: **1,420 person-level rows** spanning 2016–2019; **890 distinct incident numbers** (not independently established unique traffic-stop events); **1,220 coordinate-bearing rows** and **764 incident IDs with at least one coordinate**; **3 repeated IDs have varying dates** and **15 repeated IDs varying stop times**. These are descriptive quality statistics, **not traffic-stop acceptance**.
- There are only **266 distinct non-empty coordinate pairs** among the 1,220 motor-vehicle-occupant rows; coordinates may be address-based, anonymized, duplicated or misassigned. No geocoding accuracy or jurisdiction membership has been established.

**Decisive semantic distinction:** The [Urbana Police Department's 2016 IDOT Pedestrian Stop Data Collection Guidelines](https://www.urbanaillinois.us/sites/default/files/attachments/Explanation_of_Pedestrian_Stops_0.pdf) define the stop sheets as detentions of **persons**, including a **motor vehicle occupant not covered by an IDOT sticker**. The label `MOTOR VEHICLE NON-IVC` therefore does not indicate a motor vehicle stopped for an Illinois Vehicle Code traffic violation. Do not reclassify these person-level encounters as routine traffic stops simply because a vehicle is involved. See also Urbana Police's [2019 traffic-stop report](https://www.urbanaillinois.us/sites/default/files/attachments/UPD%20Traffic%20Stops%20-%202019%20Final.pdf), which defines IVC traffic stops separately.

**Import gate:** 0 accepted IVC vehicle traffic stops from this file. No PII, addresses, incident numbers, raw coordinate pairs, or person-level records are present in this audit document.

## Replacement sources to acquire

1. Official Urbana Police source **`Urbana Police Traffic Stops (without Offenses) from 2012–Feb 2023`** (reported by Open Policing Data Hub catalog and referenced in the Urbana Police reports; older publisher portal: `data.urbanaillinois.us`). This is the source to obtain and verify as **stop-level**.
2. Official source **`Urbana Police Traffic Stops – Offense Level (2012–Feb 2023)`** must *not* be summed at the violation level. Deduplicate reliably to stop-level identifiers and avoid overlap with item 1.
3. WBEZ's [Urbana Police traffic stops page](https://interactive.wbez.org/traffic-stops/urbana-police/) provides a separate **[Download Urbana Police data](https://drive.google.com/file/d/1A4PjkwvioJ2d05KOs8V5wCigFub1jmXZ/view)** link. Acquire and inspect its schema, provenance, spatial precision, and commercial reuse terms before adding anything to Pro. It may overlap the original IDOT source, so it cannot be naively summed with the city source.

Only after source acquisition, identity/precision verification, licencing, and privacy checks can a new reviewed source adapter be considered. Never join Urbana data to Champaign city beat polygons. A zero accepted number is better than a misleading heat map.

## Reproducibility and privacy notes

Counts were computed from the uploaded CSV using exact `STOP TYPE DESCRIPTION`, `INCIDENT NUMBER`, and `georeference` columns; source bytes were hashed with SHA-256. The audit deliberately does not expose actual case/incident IDs, names, demographic fields, addresses or raw coordinate values. The source file's `STOP DATE` parses as human-readable local dates; any future stop-level ingestion must perform strict date, event-ID, location and source-type checks, rather than treating the existence of `georeference` as sufficient evidence.

This audit does not grant a licence for commercial reuse or authorize a merge, Play upload or release.
