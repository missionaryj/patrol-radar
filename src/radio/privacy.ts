import type { GeoPoint, Incident } from './types';
export { scrub } from './parser';
export interface PrivacyConfig { gridMeters: number; publishDelayMs: number; }
export const DEFAULT_PRIVACY: PrivacyConfig = { gridMeters: 200, publishDelayMs: 12 * 60_000 };

export function coarsenPoint(p: GeoPoint, meters = DEFAULT_PRIVACY.gridMeters): GeoPoint {
  const m = Math.min(250, Math.max(150, meters)); // enforced bounds
  const dLat = m / 111_320; const lat = Math.round(p.lat / dLat) * dLat; const dLng = m / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: +lat.toFixed(5), lng: +(Math.round(p.lng / dLng) * dLng).toFixed(5) };
}
/** Only incidents first seen at least `delay` ago may be published. Delay is clamped to >= 10 min for shared output. */
export function publishable(incidents: Incident[], now: number, cfg: PrivacyConfig = DEFAULT_PRIVACY): Incident[] {
  const delay = Math.max(10 * 60_000, cfg.publishDelayMs);
  return incidents.filter(i => now - i.firstSeen >= delay);
}
