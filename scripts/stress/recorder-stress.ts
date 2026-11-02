// Stress: synthetic adverts -> matcher -> fusion -> recorder. Run: npx vite-node scripts/stress/recorder-stress.ts
import { SessionRecorder } from '../../src/recorder/recorder';
import { match } from '../../src/ble/matcher';
import { SIGNATURES } from '../../src/ble/signatures';
import { ScanFusion } from '../../src/session/extras';
import type { Advertisement } from '../../src/ble/types';
const QUOTA = 5 * 1024 * 1024; // ~ WebView localStorage (UTF-16 chars ~ 5M)
function store() { const m = new Map<string, string>(); let writes = 0, bytes = 0, quota = 0, ms = 0;
  return { getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => { writes++; bytes = v.length; if (v.length > QUOTA) { quota++; throw new Error('QuotaExceeded'); } m.set(k, v); },
    get stats() { return { writes, lastBytes: bytes, quotaErrors: quota }; } }; }
const dv = (b: number[]) => new DataView(new Uint8Array(b).buffer);
const cid = (SIGNATURES.find(s => s.rule.kind === 'companyId')!.rule as { id: number }).id;
const realNow = Date.now;
function run(name: string, perMin: number, devices: number, minutes: number, policeFrac = 0.02) {
  let now = 1_800_000_000_000; Date.now = () => now;
  const st = store(); const r = new SessionRecorder(st); const fusion = new ScanFusion();
  r.start('native'); r.event('start', 'native');
  const total = Math.round(perMin * minutes); const dt = 60_000 / perMin;
  global.gc?.(); const heap0 = process.memoryUsage().heapUsed; const cpu0 = process.cpuUsage(); const t0 = performance.now();
  let maxAddMs = 0, stored = 0;
  for (let i = 0; i < total; i++) {
    now += dt; const d = i % devices; const police = (d % Math.round(1 / policeFrac)) === 0;
    const adv: Advertisement = { sessionId: 'd' + d, name: police ? 'X6001' + d : undefined, rssi: -40 - (i % 50),
      manufacturerData: new Map([[police ? cid : 0x004c, dv([1, 2, 3, i & 255, 48, 49, 50, 51, 52, 53, 54])]]), serviceUuids: [], serviceData: new Map(), timestamp: now };
    const a = performance.now(); const m = match(adv); const loc = { lat: 40.1 + i * 1e-6, lng: -88.2 };
    if (m) fusion.ble(m, loc); if (r.add(adv, m, loc)) stored++; const e = performance.now() - a; if (e > maxAddMs) maxAddMs = e;
    if (i % 1000 === 0) r.fix(3, loc);
  }
  const wall = performance.now() - t0; const cpu = process.cpuUsage(cpu0);
  const e0 = performance.now(); const json = JSON.stringify(r.exportObject('stress')); const exportMs = performance.now() - e0;
  global.gc?.(); const heap1 = process.memoryUsage().heapUsed; r.stop(); const h = r.health;
  Date.now = realNow;
  return { name, adverts: total, devices, minutes, simRealtime: +(total / (wall / 1000) / (perMin / 60)).toFixed(0) + 'x',
    usPerAdvert: +((cpu.user + cpu.system) / total).toFixed(1), maxAddMs: +maxAddMs.toFixed(1), stored, records: r.count, dropped: (r as any).s.dropped,
    verdict: r.verdict(), heapMB: +((heap1 - heap0) / 1e6).toFixed(1), exportKB: Math.round(json.length / 1024), exportMs: Math.round(exportMs),
    lsWrites: st.stats.writes, lsKB: Math.round(st.stats.lastBytes / 1024), quotaErr: st.stats.quotaErrors, perMinuteKeys: Object.keys(h.perMinute).length, events: h.events.length };
}
const only = process.argv[2];
const cases: [string, number, number, number, number?][] = [
  ['highway 400/min 30min 100dev', 400, 100, 30], ['busy 5k/min 10min 1k dev', 5000, 1000, 10],
  ['flood 50k/min 2min 10k dev', 50000, 10000, 2], ['long 400/min 6h 2k dev', 400, 2000, 360],
  ['police-heavy 5k/min 10min 50% match', 5000, 500, 10, 0.5],
];
const out = []; for (const c of cases) if (!only || c[0].startsWith(only)) { out.push(run(...c)); console.error('done', c[0]); }
console.table(out);
