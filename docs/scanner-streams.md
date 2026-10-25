# Integrating public unencrypted scanner feeds (notes, not implemented)

Status: research notes only. No stream code ships in v0.1. Terms checked Oct 25, 2026. Re-check them before you build anything.

## What radio gives you
- Voice traffic contains **spoken** locations ("10-50 at Main and 5th"), not GPS. You only get a position after you transcribe the audio and geocode the address, and both steps make mistakes.
- Many agencies use encrypted P25/TETRA, so coverage has gaps.

## Sources and terms
| Source | Programmatic access | Notes |
|---|---|---|
| Broadcastify (broadcastify.com/terms) | Its terms prohibit scraping, programmatic access, rebroadcast, re-streaming, and embedding live audio unless you have an advance commercial license. The Calls API and Live Audio Feed Catalog are available through its Developer Program. Public redistribution of live audio is prohibited, and feed-archive API data is personal use only. | Apply to the Developer Program. Don't scrape. Linking out to the feed page is the safest option. |
| OpenMHz (openmhz.com/terms) | The API only supports OpenMHz's own frontend and iOS app. Other uses need explicit permission. Mass scraping and direct audio-file links are not allowed. Reuse of audio with credit is allowed. | Ask permission first. Credit OpenMHz. |
| Your own SDR (e.g. trunk-recorder + RTL-SDR) | Receiving with your own equipment avoids third-party terms. | You must follow local and state scanner laws, and some states restrict scanners in vehicles. Never decrypt encrypted traffic. |

## Possible pipeline (FUTURE)
1. Audio from a licensed or own-SDR source
2. Speech-to-text (e.g. Whisper, run locally)
3. Address/intersection extraction
4. Geocode to a coarse cell
5. Delay and aggregate, the same way as BLE reports

Store only the coarse location and event type, not transcripts of named people.
