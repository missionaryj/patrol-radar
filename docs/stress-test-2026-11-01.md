# Stress test, 2026-11-01

Scripts: `scripts/stress/recorder-stress.ts` (`node --expose-gc node_modules/.bin/vite-node …`), `scripts/stress/map.html` (open via `npx vite`, drive with Playwright, CPU throttled 4x as a phone proxy), `scripts/stress/chat-stress.mjs`, `scripts/stress/chat-fanout.mjs` (live Supabase, room `US-ZZ-stresstest` only).

## Recorder / matcher
| case | before µs/advert | after | notes |
|---|---|---|---|
| 400/min, 30 min, 100 dev | 17.9 | 15.3 | healthy, 240 records |
| 5k/min, 10 min, 1k dev | 24.5 | 8.8 | |
| 50k/min, 2 min, 10k dev | 37.6 | 6.7 | heap +3.5 MB |
| 400/min, 6 h, 2k dev | 127 | 106 | 361 per-minute buckets, export 862 KB / 4 ms |
| 5k/min, 50% police | **3675 (3x realtime)** | 100 (124x) | cap 5000 held, 20000 dropped, export 1.5 MB |
Cause: every stored match re-serialised the whole session (up to 1.45 MB) to localStorage. Fix: coalesce to ≤1 write / 2 s, flush on stop/page hide.

## Map (412x915, 4x CPU throttle)
| live dots | redraws/s | before fps / p95 | after fps / p95 |
|---|---|---|---|
| 40 (+Flock) | 7 | 60 / 16.7 | 60 / 16.7 |
| 200 | 80 (per advert) | 44 / 33 | 60 at ≤3.3/s |
| 1000 | 7 | **18 / 117 ms** | 58 / 16.8 (cap 150) |
| 5000 | 3.3 | – | 60 / 16.8 |
Jank threshold before: >~200 SVG dots or per-advert redraws. Fixes: canvas renderer for live layer, redraw coalesced to ≤~3/s, max 150 dots (police first, then strongest RSSI).

## Chat (live)
Held: 10 s limit (10/10 rejected; 5-way parallel race → 1 accepted), new-account cap (exactly 20/day), hide at 3 distinct reporters, duplicate/self reports rejected, 0 insert errors, insert p50 346 ms / p95 390 ms.
Broke: realtime fan-out with 30 subscribers × 30-post burst delivered 420/930 (55% lost); 15 × 15 delivered 100% (p50 340–500 ms). Fix: client re-syncs the feed every 20 s while open.
