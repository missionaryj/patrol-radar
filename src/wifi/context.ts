/**
 * Per-session, in-memory context for tiered Wi-Fi scoring. Keys are the per-session salted hashes from the native
 * service (access point hash, radio hash); nothing is persisted, and clear() drops everything on Stop.
 */
import type { WifiContext } from './tiers';

export const PERSIST_SCANS = 3, PERSIST_MIN_MS = 60_000, SCAN_GAP_MS = 20_000, BLE_WINDOW_MS = 30_000;
export type WifiBand = '2.4' | '5' | '6';
export const bandOfMHz = (f?: number): WifiBand | undefined => (!f ? undefined : f < 3000 ? '2.4' : f < 5925 ? '5' : '6');

export class WifiContextTracker {
  private ap = new Map<string, { first: number; scans: number[] }>();
  private radio = new Map<string, Set<WifiBand>>();
  private ble: { cell: string; t: number; axon: boolean }[] = [];
  /** A police-gear BLE match (caller filters: conf >= 0.5, not fixed infrastructure). */
  blePolice(cell: string, t: number, axon: boolean) { this.ble.push({ cell, t, axon }); this.ble = this.ble.filter(b => t - b.t <= BLE_WINDOW_MS); }
  /** Records one native Wi-Fi emit and returns its context. */
  observe(o: { id: string; radio?: string; band?: WifiBand; cell: string; t: number }): WifiContext {
    const a = this.ap.get(o.id) ?? { first: o.t, scans: [] };
    if (!a.scans.length || o.t - a.scans[a.scans.length - 1] >= SCAN_GAP_MS) a.scans.push(o.t);
    if (a.scans.length > 20) a.scans.shift(); this.ap.set(o.id, a);
    let dualBand = false;
    if (o.radio && o.band) { const s = this.radio.get(o.radio) ?? new Set<WifiBand>(); s.add(o.band); this.radio.set(o.radio, s); dualBand = s.has('2.4') && (s.has('5') || s.has('6')); }
    const near = this.ble.filter(b => b.cell === o.cell && Math.abs(o.t - b.t) <= BLE_WINDOW_MS);
    return { dualBand, persistent: a.scans.length >= PERSIST_SCANS && o.t - a.first >= PERSIST_MIN_MS, blePolice: near.length > 0, bleAxon: near.some(b => b.axon) };
  }
  clear() { this.ap.clear(); this.radio.clear(); this.ble = []; }
}
