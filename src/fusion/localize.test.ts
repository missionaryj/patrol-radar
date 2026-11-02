import { describe, it, expect } from 'vitest';
import { Localizer, distM } from './localize';

// Deterministic RNG + gaussian.
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const LAT0 = 40.1087, LNG0 = -88.24331, MLAT = 111_320, MLNG = MLAT * Math.cos(LAT0 * Math.PI / 180);
const ll = (x: number, y: number) => ({ lat: LAT0 + y / MLAT, lng: LNG0 + x / MLNG });

/** Drive north along x=0 from y=-400 to +400 at `mps`; device at (lateral, 0). Returns along/total error of the estimate. */
export function driveBy(seed: number, mps: number, lateral = 15, opts: { gpsSigma?: number; advHz?: number; radio?: 'ble' | 'wifi'; stopAt?: number } = {}) {
  const r = rng(seed), L = new Localizer(), dev = { x: lateral, y: 0 };
  const gs = opts.gpsSigma ?? 5, hz = opts.advHz ?? 4, radio = opts.radio ?? 'ble';
  const T = 800 / mps, t0 = 1_000_000; const end = opts.stopAt ?? T;
  let gx = 0, gy = 0; // slowly varying GPS bias (random walk), like real fixes
  for (let s = 0; s <= end; s += 1) { gx = 0.9 * gx + gauss(r) * gs * 0.45; gy = 0.9 * gy + gauss(r) * gs * 0.45; L.fix({ t: t0 + s * 1000, ...ll(gx, -400 + mps * s + gy), acc: gs * 2, speed: mps }); }
  const period = radio === 'wifi' ? 30 : 1 / hz;
  for (let s = radio === 'wifi' ? r() * 30 : 0; s <= end; s += period * (radio === 'wifi' ? 1 : 0.5 + r())) {
    const y = -400 + mps * s; const d = Math.max(1, Math.hypot(dev.x, dev.y - y));
    const p1 = radio === 'wifi' ? -40 : -55, n = radio === 'wifi' ? 3 : 2.2; // ~0 dBm BLE tag, ~100 m outdoor range
    const rssi = Math.round(p1 - 10 * n * Math.log10(d) + gauss(r) * 6);
    if (rssi < (radio === 'wifi' ? -92 : -95)) continue;
    L.observe('k', t0 + s * 1000 + gauss(r) * (radio === 'wifi' ? 0 : 30), rssi, radio);
  }
  const e = L.estimate('k'); if (!e) return undefined;
  const truth = ll(dev.x, dev.y);
  const along = Math.abs((e.lat - truth.lat) * MLAT), total = distM(e, truth);
  return { e, along, total, inside: total <= e.radius };
}
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)] }; };
function run(mps: number, lateral: number, extra: object = {}) {
  const out = Array.from({ length: 200 }, (_, i) => driveBy(i + 1, mps, lateral, extra)!).filter(Boolean);
  return { along: stats(out.map(o => o.along)), total: stats(out.map(o => o.total)), inside: out.filter(o => o.inside).length / out.length, ca: out.filter(o => o.e.quality === 'closest-approach').length / out.length, n: out.length };
}

describe('closest-approach localisation (synthetic drive-bys, 200 seeds each)', () => {
  const firstDetection = (mps: number) => { // PR #12 behaviour: pin at user position at first advert
    const errs: number[] = [];
    for (let i = 1; i <= 200; i++) { const r = rng(i); for (let y = -400; y < 400; y += mps / 4) { const d = Math.hypot(15, y); const rssi = -55 - 22 * Math.log10(d) + gauss(r) * 6; if (rssi >= -95) { errs.push(Math.hypot(15, y)); break; } } }
    return stats(errs);
  };
  for (const [mph, mps] of [[30, 13.4], [60, 26.8]] as const) {
    it(`${mph} mph, device 15 m off the road`, () => {
      const r = run(mps, 15); const base = firstDetection(mps);
      console.log(`${mph} mph lateral 15 m: along median ${r.along.median.toFixed(1)} p90 ${r.along.p90.toFixed(1)} · total median ${r.total.median.toFixed(1)} p90 ${r.total.p90.toFixed(1)} · inside circle ${(r.inside * 100).toFixed(0)}% · closest-approach ${(r.ca * 100).toFixed(0)}% · PR#12 first-detection median ${base.median.toFixed(0)} p90 ${base.p90.toFixed(0)} m`);
      expect(r.ca).toBeGreaterThan(0.9);
      expect(r.along.median).toBeLessThan(30); expect(r.total.median).toBeLessThan(35);
      expect(r.total.median).toBeLessThan(base.median / 2);
      expect(r.inside).toBeGreaterThan(0.8);
    });
    it(`${mph} mph, device 40 m off the road`, () => {
      const r = run(mps, 40);
      console.log(`${mph} mph lateral 40 m: along median ${r.along.median.toFixed(1)} p90 ${r.along.p90.toFixed(1)} · total median ${r.total.median.toFixed(1)} p90 ${r.total.p90.toFixed(1)} · inside ${(r.inside * 100).toFixed(0)}%`);
      expect(r.along.median).toBeLessThan(35); expect(r.inside).toBeGreaterThan(0.7);
    });
  }
  it('rising edge only (scan stopped before the pass) -> approx with a bigger circle', () => {
    const o = driveBy(7, 13.4, 15, { stopAt: 28 })!; // stops ~25 m before the abeam point
    expect(o.e.quality).toBe('approx'); expect(o.e.radius).toBeGreaterThanOrEqual(30);
  });
  it('Wi-Fi (one scan per 30 s) is always approx with radius >= 50 m', () => {
    const r = Array.from({ length: 100 }, (_, i) => driveBy(i + 1, 13.4, 15, { radio: 'wifi' })).filter(Boolean);
    for (const o of r) { expect(o!.e.quality).toBe('approx'); expect(o!.e.radius).toBeGreaterThanOrEqual(50); }
    const s = stats(r.map(o => o!.total)); console.log(`wifi 30 mph: total median ${s.median.toFixed(0)} p90 ${s.p90.toFixed(0)} · inside ${(r.filter(o => o!.inside).length / r.length * 100).toFixed(0)}% · n ${r.length}`);
  });
});

describe('moving target', () => {
  it('a police car driving with us is flagged moving, not pinned behind us', () => {
    const L = new Localizer(); const t0 = 0; const r = rng(3);
    for (let s = 0; s <= 60; s++) L.fix({ t: t0 + s * 1000, ...ll(0, s * 20), acc: 8, speed: 20 });
    for (let s = 0; s <= 60; s += 0.25) L.observe('car', t0 + s * 1000, Math.round(-70 + gauss(r) * 4), 'ble');
    const e = L.estimate('car')!; expect(e.quality).toBe('moving');
    expect(distM(e, ll(0, 1200))).toBeLessThan(30);
  });
  it('a parked device is not flagged moving', () => { expect(driveBy(11, 13.4)!.e.quality).not.toBe('moving'); });
});

describe('Nov 2 Cradlepoint replay', () => {
  it('a single Wi-Fi record at cell 40.1087,-88.24331 gives an approx pin there with a >= 50 m circle', () => {
    const L = new Localizer(); const t = Date.UTC(2026, 10, 2, 20, 0, 0);
    // Only the coarse cell was recorded; replay the fix stream as stationary at the cell.
    for (let s = -5; s <= 5; s++) L.fix({ t: t + s * 1000, lat: 40.1087, lng: -88.24331, acc: 10, speed: 0 });
    L.observe('wifi:cradlepoint', t, -78, 'wifi');
    const e = L.estimate('wifi:cradlepoint')!;
    expect(e.quality).toBe('approx'); expect(e.radius).toBeGreaterThanOrEqual(50);
    expect(distM(e, { lat: 40.1087, lng: -88.24331 })).toBeLessThan(1);
  });
});

describe('housekeeping', () => {
  it('ignores bogus RSSI, prunes and clears', () => {
    const L = new Localizer(); L.fix({ t: 0, lat: 1, lng: 1, acc: 5 });
    L.observe('a', 0, 0, 'ble'); L.observe('a', 0, NaN, 'ble'); expect(L.has('a')).toBe(false);
    L.observe('a', 0, -70, 'ble'); expect(L.estimate('a')!.quality).toBe('approx');
    L.prune(10 * 60_000); expect(L.has('a')).toBe(false);
    L.observe('a', 0, -70, 'ble'); L.clear(); expect(L.estimate('a')).toBeUndefined();
  });
  it('estimateAny prefers the tightest closest-approach member', () => {
    const L = new Localizer(); for (let s = 0; s <= 60; s++) L.fix({ t: s * 1000, ...ll(0, -400 + 13.4 * s), acc: 5, speed: 13.4 });
    for (let s = 0; s <= 60; s += 0.25) { const d = Math.hypot(10, -400 + 13.4 * s); L.observe('b', s * 1000, Math.round(-59 - 25 * Math.log10(d)), 'ble'); }
    L.observe('w', 20_000, -80, 'wifi');
    expect(L.estimateAny(['w', 'b'])!.quality).toBe('closest-approach');
  });
});
