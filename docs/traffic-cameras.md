# Traffic enforcement cameras layer (v2)

Built by `node scripts/fetch-traffic-cameras.mjs` into `public/data/traffic-cams/` (`index.json` + 5° tiles, ~200 KB total, loaded lazily only for tiles in view at zoom ≥ 11).
Schema per row: `[lon, lat, typeIdx, srcIdx, dir?, speedMph?, osmId?]`; types `speed | red_light | school_zone | work_zone | monitor`. Points of the same type within 30 m are merged (official city data wins over OSM; generic monitoring cameras are dropped when an enforcement camera is within 30 m).

| Source | License | Notes |
|---|---|---|
| OpenStreetMap via Overpass (`highway=speed_camera`, `enforcement=*` nodes, `type=enforcement` relations' `device` nodes, `man_made=surveillance` + `surveillance=traffic` cameras; ALPR excluded) | ODbL 1.0 | whole US |
| City of Chicago Red Light Camera Locations (thvf-6diy), Speed Camera Locations (4i42-qv3h) | Chicago Data Portal Terms of Use | speed cams are Children's Safety Zones (schools + parks), mapped as `speed` |
| DC DDOT Automated Safety Cameras | CC BY 4.0 | Speed + Red Light, fixed/unknown mobility only; stop-sign/truck skipped |
| Seattle SDOT ATSC (Active) | City of Seattle open data terms | Red Light + Fixed School Zone; block-the-box/transit-lane skipped |
| Arlington County VA DES Photo Red Cameras | Arlington open data | red light |

IIHS keeps the list of US communities with red-light/speed programs (https://www.iihs.org/research-areas/red-light-running and /speed); use it for coverage notes only, not points.
Not used: commercial camera databases (terms forbid redistribution); Philadelphia PPA red-light list (no coordinates); Baltimore ATVES (ArcGIS layer now needs a token).
Updating: see `docs/traffic-cams-update.workflow.yml` (weekly, opens a PR; not enabled).
