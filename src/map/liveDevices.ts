import type { Match } from '../ble/matcher';

/** Display-only live device tracker. Nothing here is persisted. Keyed by session-hashed ID only. */
export type Band = 'near' | 'medium' | 'far';
export const BAND_RADIUS_M: Record<Band, number> = { near: 10, medium: 30, far: 60 }; // rough estimates
export const FADE_MS = 30_000, REMOVE_MS = 120_000;

export interface LiveDevice {
  key: string; label: string; color: string; kind: 'match' | 'unmatched';
  confidence?: number; rssi: number; band: Band; lastSeen: number;
}

/** RSSI→band (rough; RSSI is a poor distance estimator). */
export function bandFor(rssi: number): Band { return rssi >= -60 ? 'near' : rssi >= -80 ? 'medium' : 'far'; }

export function colorFor(m: Match | null): string {
  if (!m) return '#8a9bb0';                       // unmatched / picked: blue-gray
  const s = m.signature;
  if (s.vendor === 'Axon' || s.category === 'body-camera' || s.category === 'cew') return '#e53935'; // red
  if (s.category === 'radio') return '#fb8c00';   // orange
  if (s.category === 'fixed') return '#ab47bc';   // purple: fixed infrastructure (Flock ALPR)
  return '#fdd835';                               // other match: yellow
}

/** Deterministic offset (meters) per key so dots don't stack; within ~8-20 m of user. */
export function offsetFor(key: string): { dx: number; dy: number } {
  let h = 2166136261; for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const ang = (h % 360) * Math.PI / 180, r = 8 + ((h >>> 9) % 13);
  return { dx: Math.cos(ang) * r, dy: Math.sin(ang) * r };
}
export function applyOffset(lat: number, lng: number, o: { dx: number; dy: number }) {
  return { lat: lat + o.dy / 111_320, lng: lng + o.dx / (111_320 * Math.cos(lat * Math.PI / 180)) };
}
export function opacityFor(lastSeen: number, now: number): number {
  const age = now - lastSeen; if (age <= FADE_MS) return 1;
  return Math.max(0.15, 1 - (age - FADE_MS) / (REMOVE_MS - FADE_MS));
}

export class LiveDeviceTracker {
  private devs = new Map<string, LiveDevice>();
  private ema = new Map<string, number>();
  constructor(private alpha = 0.3) {}
  update(key: string, rssi: number | undefined, m: Match | null, now = Date.now()) {
    const prev = this.ema.get(key);
    const r = rssi === undefined ? prev ?? -90 : prev === undefined ? rssi : prev + this.alpha * (rssi - prev);
    this.ema.set(key, r);
    const old = this.devs.get(key);
    const match = m ?? null;
    // once matched, keep match label even if a later advert lacks the signature
    const keep = !match && old?.kind === 'match';
    this.devs.set(key, keep ? { ...old!, rssi: Math.round(r), band: bandFor(r), lastSeen: now } : {
      key, kind: match ? 'match' : 'unmatched', label: match ? match.signature.label : 'unknown device',
      color: colorFor(match), confidence: match?.confidence, rssi: Math.round(r), band: bandFor(r), lastSeen: now,
    });
  }
  list(now = Date.now()): LiveDevice[] {
    for (const [k, d] of this.devs) if (now - d.lastSeen > REMOVE_MS) { this.devs.delete(k); this.ema.delete(k); }
    return [...this.devs.values()];
  }
  has(key: string) { return this.devs.has(key); }
  clear() { this.devs.clear(); this.ema.clear(); }
}
