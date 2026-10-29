/**
 * Cross-signal fusion on the COARSE grid only (cell keys from coarsen(), never precise coords).
 * - "Possible patrol car": >= 2 distinct gear types in the same cell within WINDOW_MS.
 * - Flock boost: a weak XUNTONG BLE hit is upgraded only when a Flock SSID is seen in the same cell/window.
 * State is in-memory, pruned continuously, and never persisted.
 */
export type GearType = 'body-camera' | 'cew' | 'radio' | 'vehicle-camera' | 'vehicle-router' | 'holster' | 'fixed-camera';
export interface GearEvent { cell: string; t: number; gear: GearType; ruleId: string }
export interface FusionResult { possiblePatrolCar: boolean; gearTypes: GearType[]; flockBoost: boolean }
export const WINDOW_MS = 30_000;
export const FLOCK_BOOST_CONF = 0.75;

/** Maps a signature/rule category to a gear type; null for things that are not patrol gear. */
export function gearTypeFor(category: string, ruleId: string, role?: string): GearType | null {
  if (role === 'vehicle-camera' || role === 'vehicle-router' || role === 'fixed-camera') return role;
  if (category === 'fixed') return 'fixed-camera';
  if (category === 'body-camera' || category === 'cew' || category === 'radio') return category;
  if (category === 'vehicle') return 'vehicle-camera';
  if (ruleId.startsWith('yardarm')) return 'holster';
  return null;
}

export class GearFusion {
  private events: GearEvent[] = [];
  private flagged = new Map<string, number>(); // cell -> last flag time (dedupe alerts)
  constructor(private windowMs = WINDOW_MS) {}
  private prune(now: number) { this.events = this.events.filter(e => now - e.t <= this.windowMs); for (const [c, t] of this.flagged) if (now - t > this.windowMs) this.flagged.delete(c); }
  add(e: GearEvent): FusionResult {
    this.prune(e.t); this.events.push(e);
    const inCell = this.events.filter(x => x.cell === e.cell && Math.abs(e.t - x.t) <= this.windowMs);
    const patrolTypes = [...new Set(inCell.map(x => x.gear).filter(g => g !== 'fixed-camera'))];
    const flockBoost = inCell.some(x => x.ruleId === 'flock-xuntong-cid') && inCell.some(x => x.ruleId === 'flock-ssid');
    return { possiblePatrolCar: patrolTypes.length >= 2, gearTypes: patrolTypes, flockBoost };
  }
  /** True once per cell per window, so the UI alerts once instead of on every advert. */
  shouldAlert(cell: string, now: number): boolean { if (this.flagged.has(cell)) return false; this.flagged.set(cell, now); return true; }
  clear() { this.events = []; this.flagged.clear(); }
}
