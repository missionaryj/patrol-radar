import { travel } from '../settings/travelMode';
import type { Match } from '../ble/matcher';

/** Display-only live device tracker. Nothing here is persisted. Keyed by session-hashed ID only. */
export type Band = 'near' | 'medium' | 'far';
export const BAND_RADIUS_M: Record<Band, number> = { near: 10, medium: 30, far: 60 }; // rough estimates
export const FADE_MS = 30_000, REMOVE_MS = 120_000;

export interface LiveDevice {
  key: string; label: string; color: string; kind: 'match' | 'unmatched';
  confidence?: number; rssi: number; band: Band; lastSeen: number;
  /** Which radio heard it. Wi-Fi hits get their own badge, ring colour and map marker so they stand out from BLE. */
  radio: 'ble' | 'wifi';
}
/** Wi-Fi accent (ring + badge). Distinct from Flock-mapped cyan (#00e5ff) and every category fill colour. */
export const WIFI_COLOR = '#2979ff';
export const isWifi = (m: Match | null | undefined) => m?.radio === 'wifi';

/** RSSI→band (rough; RSSI is a poor distance estimator). */
export function bandFor(rssi: number): Band { const p = travel(); return rssi >= p.bandNearDbm ? 'near' : rssi >= p.bandMediumDbm ? 'medium' : 'far'; }
/** Ring radius for a band under the current travel mode. */
export const bandRadius = (b: Band) => travel().bandRadiusM[b];

export function colorFor(m: Match | null): string {
  if (!m) return '#8a9bb0';                       // unmatched / picked: blue-gray
  const s = m.signature;
  if (s.vendor === 'Axon' || s.category === 'body-camera' || s.category === 'cew') return '#e53935'; // red
  if (s.category === 'vehicle') return '#ff1744';  // patrol-car gear (Axon Fleet / Cradlepoint Wi-Fi)
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
  constructor(private alpha?: number) {}
  update(key: string, rssi: number | undefined, m: Match | null, now = Date.now()) {
    const old0 = this.devs.get(key);
    // On foot: ignore faint non-police adverts that never were police (police matches are never dropped).
    if (!m && old0?.kind !== 'match' && rssi !== undefined && rssi < travel().minRssiUnmatched) return;
    const prev = this.ema.get(key); const alpha = this.alpha ?? travel().emaAlpha;
    const r = rssi === undefined ? prev ?? -90 : prev === undefined ? rssi : prev + alpha * (rssi - prev);
    this.ema.set(key, r);
    const old = this.devs.get(key);
    const match = m ?? null;
    // once matched, keep match label even if a later advert lacks the signature
    const keep = !match && old?.kind === 'match';
    this.devs.set(key, keep ? { ...old!, rssi: Math.round(r), band: bandFor(r), lastSeen: now } : {
      key, kind: match ? 'match' : 'unmatched', label: match ? match.signature.label : 'unknown device', radio: isWifi(match) ? 'wifi' : 'ble',
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

/**
 * Where a live dot is drawn. A police-gear hit is pinned to where it was FIRST detected (the user's display position
 * at that moment, in memory only, never stored) so it stays put as the user drives on. Before 1.0.19 every redraw
 * re-projected it around the current position, so the pin "followed" the user. Unmatched devices stay user-relative
 * (illustrative dots around "me") and are moved with the user dot every frame.
 */
export class LiveAnchors {
  private a = new Map<string, { lat: number; lng: number; t: number }>();
  constructor(private ttlMs = REMOVE_MS) {}
  /** Fixed anchor for matches/vehicles (set once, on first call), or null for user-relative items. */
  anchor(key: string, fixed: boolean, here: { lat: number; lng: number }, now = Date.now()): { lat: number; lng: number } | null {
    if (!fixed) return null;
    let p = this.a.get(key); if (!p) { p = { lat: here.lat, lng: here.lng, t: now }; this.a.set(key, p); }
    p.t = now; return { lat: p.lat, lng: p.lng };
  }
  /** Move an anchor to a better estimate (closest approach). */
  set(key: string, p: { lat: number; lng: number }, now = Date.now()) { this.a.set(key, { lat: p.lat, lng: p.lng, t: now }); }
  get(key: string) { const p = this.a.get(key); return p && { lat: p.lat, lng: p.lng }; }
  prune(now = Date.now()) { for (const [k, p] of this.a) if (now - p.t > this.ttlMs) this.a.delete(k); }
  has(key: string) { return this.a.has(key); }
  clear() { this.a.clear(); }
}
