# Radio dispatch prototype (Champaign County)

Pipeline: `IncidentSource` (transcripts or structured CAD rows) → optional `SpeechToText` → `redact` + `parseTranscript` → `Geocoder` (local C-U gazetteer → Nominatim 1 req/s, cached, county-bounded) → `coarsenPoint` (150–250 m, 200 default) → `IncidentMerger` (on scene only raises confidence) → `publishable` (≥10 min, 12 default) → blue dashed 📻 squares on their own layer.
Transcripts are never stored: the text is parsed inside `DispatchPipeline.handle` and dropped. Incidents keep only type, coarse cell, times, confidence.

## Feeds checked (Oct 26, 2026)
| Source | What | Usable? |
|---|---|---|
| RadioReference sid 4403 https://www.radioreference.com/db/sid/4403 | METCAD MDICE, P25 Phase I simulcast (851–853 MHz). Dispatch TGs in the clear: PATROL 1 21500 (CPD), PATROL 2 21501 (CCSO/Rantoul/rural), PATROL 3 21502 (Urbana PD + UIPD), PATROL 6 21505 (Parkland). Ops/tac/investigations/SWAT/METCAD ops are encrypted. | Reference only. Own SDR (RTL-SDR + trunk-recorder/SDRTrunk) can receive the clear dispatch TGs legally; never decrypt. |
| Broadcastify Calls https://www.broadcastify.com/calls/trs/4403 , county https://www.broadcastify.com/listen/ctid/600 | Per-call P25 audio, 3 ingest nodes incl. METCAD MDICE. | Terms forbid scraping/re-streaming; API only via Developer Program; Calls archive needs premium. Not usable without permission. |
| OpenMHz | No Champaign system found; API behind Cloudflare and terms restrict 3rd-party use. | No. |
| City of Champaign ArcGIS combined_incidents https://gisportal.champaignil.gov/hs/rest/services/Hosted/combined_incidents_July2023to2024/FeatureServer/0 | Fire/EMS incidents Jul 2023–Jul 2024: type, address, time, point. JSON/GeoJSON, CORS allows github.io, no key. | Yes, but historic and fire/EMS only. Wired as `ChampaignArcgisReplaySource`. |
| Champaign PD crime map (Tyler Citizen Connect) https://champaignil.gov/police/news-data/crime-data/ | Crime reports, block-level, updated daily, 60 days. | No public API; daily, not live. |
| METCAD https://www.metcad911.org/ | No public live CAD page. FOIA only. | No. |
