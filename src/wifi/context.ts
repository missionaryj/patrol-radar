import { travel } from '../settings/travelMode';
/**
 * Per-session, in-memory context for tiered Wi-Fi scoring. Keys are the per-session salted hashes from the native
 * service (access point hash, radio hash); nothing is persisted, and clear() drops everything on Stop.
 */
import type { WifiContext } from './tiers';

/**
 * Traveling-with-you pattern (1.0.23, from the 2026-11-04 field test: one Cradlepoint went -95 -> -89 -> -62 dBm in ~90 s
 * while a patrol car was in view). An AP first heard weak (<= APPROACH_WEAK_DBM) that rises to strong (>= APPROACH_STRONG_DBM)
 * within APPROACH_WINDOW_MS, over >= 2 separate scans, is closing on us: a vehicle, not a fixed router we drive past.
 */
export const APPROACH_WEAK_DBM = -90, APPROACH_STRONG_DBM = -70, APPROACH_WINDOW_MS = 120_000;
export function isApproach(samples: { t: number; rssi: number }[], weak = APPROACH_WEAK_DBM, strong = APPROACH_STRONG_DBM, windowMs = APPROACH_WINDOW_MS): boolean {
  for (let j = 0; j < samples.length; j++) {
    if (samples[j].rssi < strong) continue;
    for (let i = 0; i < j; i++) if (samples[i].rssi <= weak && samples[j].t - samples[i].t <= windowMs && samples[j].t - samples[i].t >= 5_000) return true;
  }
  return false;
}
export const PERSIST_SCANS = 3, PERSIST_MIN_MS = 60_000, SCAN_GAP_MS = 20_000, BLE_WINDOW_MS = 30_000;
export type WifiBand = '2.4' | '5' | '6';
export const bandOfMHz = (f?: number): WifiBand | undefined => (!f ? undefined : f < 3000 ? '2.4' : f < 5925 ? '5' : '6');

export class WifiContextTracker {
  private ap = new Map<string, { first: number; scans: number[]; rssi: { t: number; rssi: number }[]; cells: Set<string>; approached?: boolean }>();
  private radio = new Map<string, Set<WifiBand>>();
  private ble: { cell: string; t: number; axon: boolean }[] = [];
  /** A police-gear BLE match (caller filters: conf >= 0.5, not fixed infrastructure). */
  blePolice(cell: string, t: number, axon: boolean) { this.ble.push({ cell, t, axon }); this.ble = this.ble.filter(b => t - b.t <= travel().bleWindowMs); }
  /** Records one native Wi-Fi emit and returns its context. */
  observe(o: { id: string; radio?: string; band?: WifiBand; cell: string; t: number; rssi?: number }): WifiContext {
    const a = this.ap.get(o.id) ?? { first: o.t, scans: [], rssi: [], cells: new Set<string>() };
    a.cells.add(o.cell); if (a.cells.size > 20) a.cells.delete(a.cells.values().next().value!);
    if (typeof o.rssi === 'number') { a.rssi.push({ t: o.t, rssi: o.rssi }); a.rssi = a.rssi.filter(x => o.t - x.t <= APPROACH_WINDOW_MS); }
    // Sticky for the session: once an AP has shown the approach pattern it keeps the feature while it stays in range.
    if (!a.approached && isApproach(a.rssi)) a.approached = true;
    if (!a.scans.length || o.t - a.scans[a.scans.length - 1] >= SCAN_GAP_MS) a.scans.push(o.t);
    if (a.scans.length > 20) a.scans.shift(); this.ap.set(o.id, a);
    let dualBand = false;
    if (o.radio && o.band) { const s = this.radio.get(o.radio) ?? new Set<WifiBand>(); s.add(o.band); this.radio.set(o.radio, s); dualBand = s.has('2.4') && (s.has('5') || s.has('6')); }
    const near = this.ble.filter(b => b.cell === o.cell && Math.abs(o.t - b.t) <= travel().bleWindowMs);
    return { dualBand, persistent: a.scans.length >= travel().persistScans && o.t - a.first >= travel().persistMinMs, blePolice: near.length > 0, bleAxon: near.some(b => b.axon), approach: !!a.approached, multiCell: a.cells.size >= 2 };
  }
  clear() { this.ap.clear(); this.radio.clear(); this.ble = []; }
}
