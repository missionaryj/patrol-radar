/**
 * Travel mode: "car" (default, the tuned driving behaviour) or "foot" (walking: slower, shorter range, longer dwell).
 * Only the choice ('car' | 'foot') is persisted, in localStorage. No location or device data is involved.
 */
export type TravelMode = 'car' | 'foot';
export interface TravelProfile {
  mode: TravelMode;
  /** RSSI -> band thresholds (dBm). */
  bandNearDbm: number; bandMediumDbm: number;
  /** Ring radius per band (m). */
  bandRadiusM: { near: number; medium: number; far: number };
  /** Unmatched (non-police) adverts weaker than this are ignored on the live map. Police matches are never dropped. */
  minRssiUnmatched: number;
  /** EMA weight for live RSSI (lower = smoother). */
  emaAlpha: number;
  /** Closest-approach: running-median half-window (ms), in-memory track/series keep (ms), max ranging (m). */
  smoothHalfWindowMs: number; keepMs: number; maxRangeBleM: number; maxRangeWifiM: number;
  /** Vehicle grouping / gear fusion / Wi-Fi corroboration windows. */
  groupWindowMs: number; vehicleTtlMs: number; fusionWindowMs: number;
  persistScans: number; persistMinMs: number; bleWindowMs: number;
}
export const PROFILES: Record<TravelMode, TravelProfile> = {
  car: {
    mode: 'car', bandNearDbm: -60, bandMediumDbm: -80, bandRadiusM: { near: 10, medium: 30, far: 60 }, minRssiUnmatched: -120, emaAlpha: 0.3,
    smoothHalfWindowMs: 750, keepMs: 180_000, maxRangeBleM: 80, maxRangeWifiM: 150,
    groupWindowMs: 30_000, vehicleTtlMs: 120_000, fusionWindowMs: 30_000, persistScans: 3, persistMinMs: 60_000, bleWindowMs: 30_000,
  },
  foot: {
    mode: 'foot', bandNearDbm: -65, bandMediumDbm: -82, bandRadiusM: { near: 5, medium: 15, far: 35 }, minRssiUnmatched: -90, emaAlpha: 0.15,
    smoothHalfWindowMs: 2_000, keepMs: 300_000, maxRangeBleM: 50, maxRangeWifiM: 100,
    groupWindowMs: 60_000, vehicleTtlMs: 300_000, fusionWindowMs: 60_000, persistScans: 3, persistMinMs: 120_000, bleWindowMs: 60_000,
  },
};
export const TRAVEL_KEY = 'pr.travelmode';
let active: TravelProfile = PROFILES.car;
export const travel = (): TravelProfile => active;
export function setTravelMode(m: TravelMode, store: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  active = PROFILES[m] ?? PROFILES.car; try { store?.setItem(TRAVEL_KEY, active.mode); } catch { /* private mode */ }
  return active;
}
export function loadTravelMode(store: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): TravelMode {
  let v: string | null = null; try { v = store?.getItem(TRAVEL_KEY) ?? null; } catch { /* ignore */ }
  active = v === 'foot' ? PROFILES.foot : PROFILES.car; return active.mode;
}
