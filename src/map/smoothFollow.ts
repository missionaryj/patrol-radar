/**
 * Smooth "my location" motion between GPS fixes (display only — nothing here is stored or sent).
 * Pure math so it can be unit-tested; MapView drives it from requestAnimationFrame.
 */
export interface Fix { lat: number; lng: number; acc: number; t: number; speed?: number | null; heading?: number | null; }
export interface LatLng { lat: number; lng: number; }
/** Velocity in metres/second, north (vn) and east (ve). */
export interface Vel { vn: number; ve: number; }

const M_PER_DEG = 111_320;
export const PREDICT_CAP_MS = 1500;   // never extrapolate further than this past the last fix
export const MIN_SPEED = 0.7;         // m/s; below this we treat the user as stopped (no prediction)
export const MAX_SPEED = 70;          // m/s; ignore absurd derived speeds (GPS jumps)
export const SNAP_M = 60;             // if the display is this far from where it should be, jump instead of gliding
export const EASE_MS = 220;           // glide time constant toward the target

export function distM(a: LatLng, b: LatLng): number {
  const dn = (b.lat - a.lat) * M_PER_DEG, de = (b.lng - a.lng) * M_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dn, de);
}
function offset(p: LatLng, n: number, e: number): LatLng {
  return { lat: p.lat + n / M_PER_DEG, lng: p.lng + e / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)) };
}

/** Velocity from the device's speed+heading, else derived from the last two fixes; null when stopped/unknown. */
export function velocityFor(cur: Fix, prev?: Fix): Vel | null {
  if (cur.speed != null && Number.isFinite(cur.speed)) {
    if (cur.speed < MIN_SPEED) return null;
    if (cur.heading != null && Number.isFinite(cur.heading)) {
      const h = (cur.heading * Math.PI) / 180; return { vn: cur.speed * Math.cos(h), ve: cur.speed * Math.sin(h) };
    }
  }
  if (!prev) return null;
  const dt = (cur.t - prev.t) / 1000; if (dt <= 0.2 || dt > 5) return null;
  const vn = ((cur.lat - prev.lat) * M_PER_DEG) / dt, ve = ((cur.lng - prev.lng) * M_PER_DEG * Math.cos((cur.lat * Math.PI) / 180)) / dt;
  const s = Math.hypot(vn, ve);
  // A move smaller than the fixes' accuracy is mostly noise.
  if (s < MIN_SPEED || s > MAX_SPEED || s * dt < Math.min(cur.acc, prev.acc) * 0.5) return null;
  return { vn, ve };
}

/** Where the user probably is at `now`: last fix + velocity × elapsed time, capped at PREDICT_CAP_MS. */
export function predict(fix: Fix, vel: Vel | null, now: number): LatLng {
  if (!vel) return { lat: fix.lat, lng: fix.lng };
  const dt = Math.min(Math.max(0, now - fix.t), PREDICT_CAP_MS) / 1000;
  return offset(fix, vel.vn * dt, vel.ve * dt);
}

/** One animation step from `disp` toward `target`. Snaps when far off (e.g. bad prediction or first fix). */
export function step(disp: LatLng, target: LatLng, frameMs: number): LatLng {
  if (distM(disp, target) > SNAP_M) return { ...target };
  const k = 1 - Math.exp(-Math.max(0, frameMs) / EASE_MS);
  return { lat: disp.lat + (target.lat - disp.lat) * k, lng: disp.lng + (target.lng - disp.lng) * k };
}

/** True when the loop can stop: no motion expected and the dot has settled. */
export function settled(disp: LatLng, target: LatLng, vel: Vel | null, fix: Fix, now: number): boolean {
  const predicting = !!vel && now - fix.t < PREDICT_CAP_MS;
  return !predicting && distM(disp, target) < 0.3;
}

export class SmoothLocation {
  fix?: Fix; private prev?: Fix; vel: Vel | null = null; disp?: LatLng; acc = 0;
  /** Feed a new GPS fix. Returns true for the very first fix. */
  push(f: Fix): boolean {
    const first = !this.fix; this.prev = this.fix; this.fix = f; this.vel = velocityFor(f, this.prev);
    if (first) { this.disp = { lat: f.lat, lng: f.lng }; this.acc = f.acc; }
    return first;
  }
  /** Advance the display state; returns whether more frames are needed. */
  tick(now: number, frameMs: number): boolean {
    if (!this.fix || !this.disp) return false;
    const target = predict(this.fix, this.vel, now);
    this.disp = step(this.disp, target, frameMs);
    this.acc += (this.fix.acc - this.acc) * (1 - Math.exp(-frameMs / EASE_MS));
    if (settled(this.disp, target, this.vel, this.fix, now)) { this.disp = target; this.acc = this.fix.acc; return false; }
    return true;
  }
}
