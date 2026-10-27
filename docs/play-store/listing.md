# Store listing

**App name:** Patrol Radar
**Short description (≤80):** Passive Bluetooth map of nearby public-safety gear. Coarse, delayed, private.
**Category:** Maps & Navigation (alternative: Tools). Tags: Bluetooth, maps, community.
**Contact:** https://github.com/missionaryj/patrol-radar/issues
**Privacy policy:** https://missionaryj.github.io/patrol-radar/privacy/

## Full description
Patrol Radar is a public-awareness map. It listens passively for Bluetooth Low Energy signals that equipment such as body cameras, in-car systems and fixed license-plate cameras already broadcast in public, and shows likely matches on a coarse map.

How it works
• Passive only: Patrol Radar never connects to, pairs with or sends anything to another device.
• Coarse by design: detections are snapped to a 150–250 m grid, never exact positions.
• Private: device IDs are hashed with a salt that changes every session. No MAC addresses or serial numbers are kept. Your precise location is shown on your screen only and never saved.
• Optional shared map: if you turn it on, only the grid cell, a 5-minute time slot, the gear category and a confidence level are shared. Shared reports are delayed 12–17 minutes and expire after 2 hours.
• Optional dispatch layer: public incident data is shown on the coarse grid, delayed at least 10 minutes, with names, unit IDs and plates removed.
• Background scanning shows a persistent notification and stops when you tap Stop.
• No accounts, ads or analytics.

Limitations
Bluetooth range is about 100–150 m. Matches are probabilistic and many devices broadcast nothing. Do not rely on the app for safety decisions. Always follow the law and the directions of public-safety personnel. Do not use the app while driving.
