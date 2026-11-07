# Historical stop heat (v2)

Shaded beats and ~150 m cells for **where stops have tended to occur**. Not live pins, not a person, and not a scan hit. Built by:

```bash
node scripts/fetch-stop-heat.mjs
node scripts/fetch-stop-heat.mjs --only opp_chicago,urbana
node scripts/fetch-stop-heat.mjs --cache /tmp/stop-heat
```

Output is `public/data/stop-heat/` (`index.json`, `beats/<place>.json`, `tiles/<lat>_<lng>.json`). The map loads beat polygons up front and grid tiles for the current view at zoom 11 and closer. A raw download is streamed in a temp directory (or `--cache`) and deleted unless you passed `--cache`. It is never written under `public/` or committed.

## What is stored

Each beat or grid cell keeps counts only: year, 4-hour time of day, day of week, and, when the source has them, citation / warning / arrest counts plus a short reason category (speeding, signal, equipment, …). The grid is **150 m**, the same snap the live map uses, inside the 150–250 m privacy band (`GRID_M` in `scripts/stop-heat-lib.mjs`). A published coordinate is snapped to that grid unless it falls in a beat polygon or carries a beat code that matches one. The coordinate itself is not stored.

The ingest reads an allow-list of columns. Officer name, badge, officer id, driver name, address, city, state, ZIP, date of birth, license number, and demographic fields are not selected and `makeStop()` throws if one is passed in. `assertOutputClean()` runs again before anything is written.

## Sources in the default build

| Source | License | How it is drawn |
|---|---|---|
| [Stanford Open Policing Project](https://openpolicing.stanford.edu/data/), Chicago file (ODC-BY 1.0) | Open Data Commons Attribution License | Beat choropleth. Standardized stops from about 2012–2016 and 2018–2020. Beat outlines are the project shapefile. Rows with no beat code are placed by point-in-polygon, then the 150 m grid if they fall outside. Last substantial OPP update documented in 2023 (stops through about 2020). |
| [City of Urbana IDOT stop sheets](https://data.illinois.gov/Local-Government/City-Of-Urbana-IDOT-Stop-Sheet-Police-Data-/vnxf-tjw4) | City of Urbana open data | 150 m grid, or a Champaign beat when the point falls inside one. Street addresses are not stored. |
| [NYPD Vehicle Stop Reports](https://data.cityofnewyork.us/d/hn9i-dwpr) | NYC Open Data | Precinct choropleth joined on the published command code. The coordinate is not stored. |
| [Montgomery County, MD electronic traffic violations](https://data.montgomerycountymd.gov/Public-Safety/Traffic-Violations/4mse-ku6q) | dataMontgomery | 150 m grid. Person and vehicle fields are not requested. |
| [Champaign police beats](https://gisportal.champaignil.gov/ms/rest/services/Open_Data/Open_Data/MapServer/25) | City of Champaign open data | Polygon join only. A beat is drawn when at least one ingested stop falls inside it. |

The map and Settings name these sources. The Stanford Open Policing Project requires attribution under ODC-BY.

## Fetched by the script only when you opt in, or not drawn

These are real public files. They are listed in `index.json` under `notMapped` and in Settings so the gap is visible.

- **Illinois statewide OPP** (~12 million IDOT-style rows). Mostly beat codes, no coordinates, and no statewide beat polygons in this repo. Do not commit the raw file.
- **Connecticut** ([data.ct.gov traffic stops](https://data.ct.gov/d/nahi-zqrt)). Town and intersection text, no coordinates. Intersections are not geocoded.
- **San Diego OPP**. Service-area codes and no coordinates. The project shapefile is nine divisions and does not use those codes.
- **San Diego RIPA** ([data.sandiego.gov](https://data.sandiego.gov/datasets/police-ripa-stops/)). Beat name and street block, no latitude/longitude. Block addresses are not geocoded and are not stored.

Nationwide coverage is the same pipeline: any OPP CSV with coordinates or with beat codes plus a polygon file can be aggregated by extending `PIPELINE` in `scripts/fetch-stop-heat.mjs`. The default build does not download every jurisdiction, because many files are multi-gigabyte and many have no mappable geography.

## Not in this layer

No FOIA requests, no court or clerk scraping, no live CAD, scanner audio, or OpenMHz, and no Google Play Billing. The settings toggle is there so the layer can be tested. A later subscription may hide it; nothing here charges or locks it.

## Map

Settings → Stop history holds the display toggle, year / time-of-day / weekday filters, color scale, source links, license and data-coverage notes. The driving map draws historical beat or ~150 m cell shading only: these shapes never open a popup, tooltip or external site when tapped in 2D or 3D. Other map markers keep their own interactions. The location dot stays above the shading, and grid cells appear at zoom 11+. The 3D view mirrors this visual-only layer under the location dot.
