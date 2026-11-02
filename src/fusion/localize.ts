/**
 * Closest-approach localisation of a hit along the user's own track. DISPLAY ONLY: the track and RSSI series live in
 * memory for ~3 min, are cleared on Stop, and are never stored, exported or sent. The recorder keeps only coarse cells.
 *
 * Idea: driving past a stationary transmitter, RSSI peaks when we are closest to it, so the device sits roughly abeam
 * of our position at the (smoothed) peak time. Along-road error is small; across-road (which side, how far) is not
 * observable from one straight pass, so it goes into the uncertainty radius.
 */
export interface Fix { t: number; lat: number; lng: number; acc: number; speed?: number | null }
export interface Sample { t: number; rssi: number }
export type Radio = 'ble' | 'wifi';
export interface Estimate {
  lat: number; lng: number; radius: number;
  /** closest-approach = interior RSSI peak; approx = rising edge only / too few samples / Wi-Fi; moving = target seems to move with us */
  quality: 'closest-approach' | 'approx' | 'moving';
  samples: number; peakRssi: number; rangeM: number;
}

const KEEP_MS = 180_000;
const M_PER_DEG = 111_320;

export class TrackBuffer {
  private f: (Fix & { s: number })[] = [];
  push(x: Fix) {
    if (!Number.isFinite(x.lat) || !Number.isFinite(x.lng)) return;
    const L = this.f[this.f.length - 1];
    if (L && x.t <= L.t) return; // out of order / duplicate
    this.f.push({ ...x, s: L ? L.s + distM(L, x) : 0 }); const cut = x.t - KEEP_MS; while (this.f.length && this.f[0].t < cut) this.f.shift();
  }
  /** Distance travelled (m) along the track at time t; extrapolated with the end speed outside the buffer. */
  along(t: number): number {
    const f = this.f; if (!f.length) return 0;
    if (t <= f[0].t) return f[0].s - (f[0].speed ?? 0) * (f[0].t - t) / 1000;
    const L = f[f.length - 1]; if (t >= L.t) return L.s + (L.speed ?? 0) * (t - L.t) / 1000;
    let lo = 0, hi = f.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m].t <= t) lo = m; else hi = m; }
    const a = f[lo], b = f[hi]; return a.s + (b.s - a.s) * (t - a.t) / (b.t - a.t);
  }
  get length() { return this.f.length; }
  last() { return this.f[this.f.length - 1]; }
  /** Position at time t, linearly interpolated (clamped to the ends, with `gapS` = seconds outside the buffer). */
  at(t: number): (Fix & { gapS: number }) | undefined {
    const f = this.f; if (!f.length) return undefined;
    if (t <= f[0].t) return { ...f[0], t, gapS: (f[0].t - t) / 1000 };
    const L = f[f.length - 1]; if (t >= L.t) return { ...L, t, gapS: (t - L.t) / 1000 };
    let lo = 0, hi = f.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m].t <= t) lo = m; else hi = m; }
    const a = f[lo], b = f[hi], k = (t - a.t) / (b.t - a.t);
    return { t, lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k, acc: a.acc + (b.acc - a.acc) * k, speed: speedOf(a, b), gapS: 0 };
  }
  clear() { this.f = []; }
}
/**
 * Least-squares fit of a stationary-transmitter pass: rssi(t) = A - 10 n log10(hypot(d0, along(t) - along(tc))).
 * Grid over the closest-approach time tc and lateral offset d0; A in closed form; residuals clipped at 10 dB (robust).
 */
export function fitPass(s: Sample[], along: (t: number) => number, n = 2) {
  const xs = s.map(x => along(x.t)); const t0 = s[0].t, t1 = s[s.length - 1].t;
  const step = Math.max(100, (t1 - t0) / 240);
  let best = { tc: t0, d0: 0, cost: Infinity, A: 0 };
  for (const d0 of [5, 8, 12, 16, 20, 25, 30, 40, 50, 65, 80, 100, 130]) for (let tc = t0; tc <= t1; tc += step) {
    const c = along(tc); let sa = 0; const pl = xs.map(x => 10 * n * Math.log10(Math.hypot(d0, x - c)));
    for (let i = 0; i < s.length; i++) sa += s[i].rssi + pl[i]; const A = sa / s.length;
    let cost = 0; for (let i = 0; i < s.length; i++) { const r = Math.min(10, Math.abs(s[i].rssi - (A - pl[i]))); cost += r * r; }
    if (cost < best.cost) best = { tc, d0, cost, A };
  }
  return { ...best, rms: Math.sqrt(best.cost / s.length) };
}
function speedOf(a: Fix, b: Fix) { return b.speed ?? (distM(a, b) / Math.max(0.001, (b.t - a.t) / 1000)); }
export function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dy = (b.lat - a.lat) * M_PER_DEG, dx = (b.lng - a.lng) * M_PER_DEG * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}

/** Log-distance path loss, used only to size the uncertainty circle (RSSI ranging is ±50-100 % on its own). */
export function rangeFromRssi(rssi: number, radio: Radio, txPower?: number) {
  const p1 = radio === 'wifi' ? -40 : txPower !== undefined && txPower > -30 && txPower < 20 ? txPower - 41 : -59;
  const n = radio === 'wifi' ? 3 : 2; // outdoors ~2; a low n errs toward a bigger (honest) circle
  return Math.min(radio === 'wifi' ? 150 : 80, Math.max(5, 10 ** ((p1 - rssi) / (10 * n))));
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export class Localizer {
  readonly track = new TrackBuffer();
  private series = new Map<string, { radio: Radio; tx?: number; s: Sample[] }>();
  /** Max samples per device (BLE at ~10/s for 30 s is plenty). */
  static CAP = 400;
  fix(x: Fix) { this.track.push(x); }
  observe(key: string, t: number, rssi: number | undefined, radio: Radio, txPower?: number) {
    if (typeof rssi !== 'number' || !Number.isFinite(rssi) || rssi >= 0 || rssi < -120) return;
    let e = this.series.get(key); if (!e) { e = { radio, s: [] }; this.series.set(key, e); }
    if (txPower !== undefined) e.tx = txPower;
    const s = e.s; let i = s.length; while (i > 0 && s[i - 1].t > t) i--; s.splice(i, 0, { t, rssi });
    const cut = t - KEEP_MS; while (s.length && s[0].t < cut) s.shift(); if (s.length > Localizer.CAP) s.splice(0, s.length - Localizer.CAP);
  }
  has(key: string) { return this.series.has(key); }
  prune(now = Date.now()) { for (const [k, e] of this.series) if (!e.s.length || now - e.s[e.s.length - 1].t > KEEP_MS) this.series.delete(k); }
  clear() { this.series.clear(); this.track.clear(); }
  /** Drop per-device series but keep our own recent track (Stop then Start right away). */
  clearSeries() { this.series.clear(); }

  estimate(key: string): Estimate | undefined {
    const e = this.series.get(key); if (!e || !e.s.length || !this.track.length) return undefined;
    const s = e.s, radio = e.radio;
    // 1. Smooth: running median over ±0.75 s (BLE fading is ~6 dB per advert).
    const W = 750; const sm: number[] = [];
    for (let i = 0, lo = 0, hi = 0; i < s.length; i++) {
      while (s[lo].t < s[i].t - W) lo++; while (hi + 1 < s.length && s[hi + 1].t <= s[i].t + W) hi++;
      sm.push(median(s.slice(lo, hi + 1).map(x => x.rssi)));
    }
    const max = Math.max(...sm);
    const range = rangeFromRssi(max - 4, radio, e.tx); // max of a noisy series is biased high (~+4 dB)
    const last = s[s.length - 1];
    const smin = Math.min(...sm);
    const travel = this.track.along(last.t) - this.track.along(s[0].t);
    // 2. Moving target: heard over >600 m of our own travel, and a parked-transmitter pass explains the RSSI
    //    no better than a flat line (a parked tag heard over 400 m fades by >15 dB; a car driving with us stays flat).
    const fit = radio === 'ble' && s.length >= 6 && travel > 30 ? fitPass(s, t => this.track.along(t)) : undefined;
    if (fit && s.length >= 10 && travel > 600) {
      const mean = s.reduce((a, x) => a + x.rssi, 0) / s.length;
      const flat = s.reduce((a, x) => a + Math.min(10, Math.abs(x.rssi - mean)) ** 2, 0);
      if (fit.cost > 0.75 * flat && max - smin < 12) {
        const pLast = this.track.at(last.t)!;
        return { lat: pLast.lat, lng: pLast.lng, radius: Math.round(Math.hypot(pLast.acc, range) + 30), quality: 'moving', samples: s.length, peakRssi: max, rangeM: Math.round(range) };
      }
    }
    // 3. Closest approach: the pass model needs an interior minimum (signal rose, then fell).
    if (fit) {
      const sc = this.track.along(fit.tc), s0 = this.track.along(s[0].t), s1 = this.track.along(last.t);
      // enough fade on both sides of tc to be a real peak (>= ~4 dB, i.e. the pass was at least ~0.6 d0 each way)
      const margin = Math.max(10, 0.6 * fit.d0);
      if (sc - s0 >= margin && s1 - sc >= margin && fit.rms < 8) {
        const at = this.track.at(fit.tc)!; const speed = at.speed ?? 0;
        const along = Math.hypot(at.acc, speed * 0.5, speed * at.gapS, 0.35 * fit.d0); // tc is less sharp for far devices
        const lateral = Math.max(fit.d0, 10) * 1.3; // d0 itself is noisy (~±30 %); side of road unknown
        return { lat: at.lat, lng: at.lng, radius: Math.round(Math.min(200, Math.max(15, Math.hypot(along, lateral)))), quality: 'closest-approach', samples: s.length, peakRssi: max, rangeM: Math.round(fit.d0) };
      }
    }
    let tw = 0, ws = 0; for (let i = 0; i < s.length; i++) if (sm[i] >= max - 1.5) { tw += s[i].t; ws++; }
    const tPeak = tw / ws; const at = this.track.at(tPeak)!; const speed = at.speed ?? 0;
    // 4. Approx: strongest point so far (rising edge, or Wi-Fi with ~1-2 samples per pass whose scan time is ±seconds).
    const timeUnc = radio === 'wifi' ? 5 : 2;
    const r = Math.hypot(at.acc, range, speed * (timeUnc + at.gapS));
    return { lat: at.lat, lng: at.lng, radius: Math.round(Math.min(400, Math.max(radio === 'wifi' ? 50 : 30, r))), quality: 'approx', samples: s.length, peakRssi: max, rangeM: Math.round(range) };
  }
  /** Best estimate across several keys (a grouped vehicle): the tightest non-moving one, else any. */
  estimateAny(keys: string[]): Estimate | undefined {
    const es = keys.map(k => this.estimate(k)).filter((x): x is Estimate => !!x);
    const rank = (e: Estimate) => (e.quality === 'closest-approach' ? 0 : e.quality === 'approx' ? 1000 : 2000) + e.radius;
    return es.sort((a, b) => rank(a) - rank(b))[0];
  }
}
