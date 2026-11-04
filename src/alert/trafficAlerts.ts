/**
 * Upcoming traffic-camera alerts. Runs on-device only: the precise position and heading are used in memory to pick
 * the next camera and are never stored or sent. Only the user's choices below are saved (localStorage).
 */
import type { TcPoint, TcType } from '../map/trafficCamLayer';
import type { TravelMode } from '../settings/travelMode';
export type AlertStyle = 'sound' | 'vibrate' | 'silent';
export type AlertDistance = 'auto' | 150 | 300 | 500;
export interface TcSettings {
  show: boolean; types: Record<TcType, boolean>;
  alerts: boolean; alertTypes: Record<TcType, boolean>;
  distance: AlertDistance; aheadOnly: boolean; style: AlertStyle;
}
export const TC_SETTINGS_KEY = 'pr.tcam.v1';
export const REPEAT_MS = 10 * 60_000;
export const AHEAD_DEG = 45;
export const DEFAULT_TC_SETTINGS: TcSettings = {
  show: true, types: { speed: true, red_light: true, school_zone: true, work_zone: true, monitor: true },
  alerts: true, alertTypes: { speed: true, red_light: true, school_zone: true, work_zone: true, monitor: false },
  distance: 'auto', aheadOnly: true, style: 'sound',
};
export function loadTcSettings(s: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): TcSettings {
  const d = structuredClone(DEFAULT_TC_SETTINGS);
  try {
    const v = JSON.parse(s?.getItem(TC_SETTINGS_KEY) ?? 'null');
    if (v && typeof v === 'object') {
      for (const k of ['show', 'alerts', 'aheadOnly'] as const) if (typeof v[k] === 'boolean') d[k] = v[k];
      if (['auto', 150, 300, 500].includes(v.distance)) d.distance = v.distance;
      if (['sound', 'vibrate', 'silent'].includes(v.style)) d.style = v.style;
      for (const k of ['types', 'alertTypes'] as const) if (v[k]) for (const t of Object.keys(d[k]) as TcType[]) if (typeof v[k][t] === 'boolean') d[k][t] = v[k][t];
    }
    // Earlier builds stored only the map switch.
    if (!v && s?.getItem('pr.trafficcams') === '0') d.show = false;
  } catch { /* defaults */ }
  return d;
}
export const saveTcSettings = (st: TcSettings, s: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) => { try { s?.setItem(TC_SETTINGS_KEY, JSON.stringify(st)); s?.setItem('pr.trafficcams', st.show ? '1' : '0'); } catch { /* ignore */ } };
/** A type alerts only when alerts are on, the layer and that type are shown, and the type is ticked under "Alert me for". */
export const alertsFor = (st: TcSettings, t: TcType) => st.alerts && st.show && st.types[t] && st.alertTypes[t];
/** Auto: on foot 100 m; in a car ~20 s of travel at current speed, 250-600 m (400 m when speed is unknown). */
export function alertDistanceM(st: TcSettings, mode: TravelMode, speedMps?: number | null): number {
  if (st.distance !== 'auto') return st.distance;
  if (mode === 'foot') return 100;
  return speedMps && speedMps > 0.5 ? Math.min(600, Math.max(250, speedMps * 20)) : 400;
}
const R = 6_371_000, rad = Math.PI / 180;
export function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
export const angDiff = (a: number, b: number) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };
/** Ahead = camera bearing within 45° of heading. If the camera's direction is known it must also line up with the road
 *  we're on (within 60° of heading either way, since sources mix "approach" and "facing" conventions). */
export function isAhead(me: { lat: number; lng: number }, heading: number, cam: TcPoint) {
  if (angDiff(bearing(me, cam), heading) > AHEAD_DEG) return false;
  if (cam.dir === undefined) return true;
  return angDiff(cam.dir, heading) <= 60 || angDiff(cam.dir + 180, heading) <= 60;
}
export interface Fix { lat: number; lng: number; speed?: number | null; heading?: number | null; t: number }
export interface TcAlert { cam: TcPoint; distM: number }
export class TrafficAlerter {
  private seen = new Map<string, number>(); private prev?: Fix; private hdg?: number;
  /** Heading from GPS when moving, else derived from the last fix at least 8 m away. Never stored. */
  heading(f: Fix): number | undefined {
    if (f.heading != null && Number.isFinite(f.heading) && (f.speed ?? 1) > 0.8) this.hdg = f.heading;
    else if (this.prev && distM(this.prev, f) >= 8) this.hdg = bearing(this.prev, f);
    if (!this.prev || distM(this.prev, f) >= 8) this.prev = f;
    return this.hdg;
  }
  /** Nearest eligible camera within range that hasn't alerted in the last 10 min, or null. */
  check(f: Fix, cams: TcPoint[], st: TcSettings, mode: TravelMode): TcAlert | null {
    const h = this.heading(f);
    if (!st.alerts || !st.show) return null;
    const max = alertDistanceM(st, mode, f.speed); let best: TcAlert | null = null;
    for (const c of cams) {
      if (!alertsFor(st, c.type)) continue;
      const d = distM(f, c); if (d > max) continue;
      if (st.aheadOnly && h !== undefined && !isAhead(f, h, c)) continue;
      const k = `${c.lat.toFixed(4)},${c.lng.toFixed(4)},${c.type}`, last = this.seen.get(k);
      if (last !== undefined && f.t - last < REPEAT_MS) continue;
      if (!best || d < best.distM) best = { cam: c, distM: d };
    }
    if (best) this.seen.set(`${best.cam.lat.toFixed(4)},${best.cam.lng.toFixed(4)},${best.cam.type}`, f.t);
    return best;
  }
  reset() { this.seen.clear(); this.prev = undefined; this.hdg = undefined; }
}
export const roundDist = (m: number) => m < 100 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${Math.round(m / 50) * 50} m`;
