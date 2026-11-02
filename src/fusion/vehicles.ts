import { travel } from '../settings/travelMode';
/**
 * Multi-signal patrol vehicle grouping. Detections from different radios / signatures (BLE + Wi-Fi, or two different
 * BLE gear types) that are seen close in time, in the same coarse grid cell, and whose RSSI moves together are merged
 * into one "vehicle" entry with a combined, capped confidence.
 *
 * Privacy: members are the per-session salted hashes the scanners already use; cells are coarse (150 m) keys; no MACs,
 * BSSIDs, SSIDs, serials or officer ids are seen here. State is in memory only; export() returns counts and rule ids.
 */
export type Radio = 'ble' | 'wifi';
export interface VehicleDetection {
  key: string; radio: Radio; ruleId: string; vendor: string; gear: string; confidence: number; rssi?: number; t: number; cell: string;
}
export interface VehicleMember { key: string; radio: Radio; ruleId: string; vendor: string; gear: string; confidence: number; lastSeen: number; samples: { t: number; rssi: number }[] }
export interface Vehicle {
  id: string; cell: string; firstSeen: number; lastSeen: number; members: VehicleMember[];
  confidence: number; baseConfidence: number; boost: number; rssiCorrelated: boolean; radios: Radio[];
}
export const GROUP_WINDOW_MS = 30_000, VEHICLE_TTL_MS = 120_000;
/** Corroboration boost caps: never more than +0.25 over the best member, +0.15 without an RSSI correlation; hard cap 0.95. */
export const MAX_BOOST = 0.25, MAX_BOOST_UNCORRELATED = 0.15, MAX_VEHICLE_CONF = 0.95;
export const MIN_CORR = 0.5, MAX_RSSI_SPREAD_DB = 25, BUCKET_MS = 5_000;

/** Pearson correlation of two RSSI series bucketed to 5 s; null when fewer than 3 shared buckets. */
export function rssiCorrelation(a: { t: number; rssi: number }[], b: { t: number; rssi: number }[]): number | null {
  const bucket = (s: { t: number; rssi: number }[]) => { const m = new Map<number, number[]>(); for (const x of s) { const k = Math.floor(x.t / BUCKET_MS); (m.get(k) ?? m.set(k, []).get(k)!).push(x.rssi); } return new Map([...m].map(([k, v]) => [k, v.reduce((p, c) => p + c, 0) / v.length])); };
  const A = bucket(a), B = bucket(b); const ks = [...A.keys()].filter(k => B.has(k)); if (ks.length < 3) return null;
  const xs = ks.map(k => A.get(k)!), ys = ks.map(k => B.get(k)!); const mx = xs.reduce((p, c) => p + c, 0) / xs.length, my = ys.reduce((p, c) => p + c, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (sxx === 0 || syy === 0) return sxx === syy ? 1 : 0; // both flat = consistent; one flat = no evidence
  return sxy / Math.sqrt(sxx * syy);
}
const lastRssi = (m: VehicleMember) => m.samples[m.samples.length - 1]?.rssi;
/** Two members are independent evidence if they come from different radios or different gear types / vendors. */
const independent = (a: VehicleMember, b: { radio: Radio; gear: string; vendor: string }) => a.radio !== b.radio || a.gear !== b.gear || a.vendor !== b.vendor;

/** Combined confidence: noisy-OR over independent members, then capped at best + boost cap and MAX_VEHICLE_CONF. */
export function combine(members: VehicleMember[], correlated: boolean): { confidence: number; base: number; boost: number } {
  const base = Math.max(...members.map(m => m.confidence));
  // One piece of evidence per (radio, gear, vendor): the strongest member of each.
  const per = new Map<string, number>(); for (const m of members) { const k = `${m.radio}|${m.gear}|${m.vendor}`; per.set(k, Math.max(per.get(k) ?? 0, m.confidence)); }
  const or = 1 - [...per.values()].reduce((p, c) => p * (1 - c), 1);
  const cap = Math.min(MAX_VEHICLE_CONF, base + (correlated ? MAX_BOOST : MAX_BOOST_UNCORRELATED));
  const confidence = +Math.min(cap, Math.max(base, or)).toFixed(2);
  return { confidence, base, boost: +(confidence - base).toFixed(2) };
}

export class VehicleGrouper {
  private members = new Map<string, VehicleMember & { cell: string }>();
  private vehicles = new Map<string, Vehicle>();
  private seq = 0; private everFormed = 0;
  /** Ever-formed vehicles (for the debug file), keyed by id; kept as a summary only. */
  readonly history = new Map<string, { id: string; cell: string; firstSeen: number; lastSeen: number; members: { radio: Radio; ruleId: string; gear: string; dev: string }[]; confidence: number; baseConfidence: number; boost: number; rssiCorrelated: boolean }>();
  add(d: VehicleDetection): Vehicle | undefined {
    this.prune(d.t);
    const m = this.members.get(d.key) ?? { key: d.key, radio: d.radio, ruleId: d.ruleId, vendor: d.vendor, gear: d.gear, confidence: 0, lastSeen: d.t, samples: [], cell: d.cell };
    m.confidence = Math.max(m.confidence, d.confidence); m.ruleId = m.confidence === d.confidence ? d.ruleId : m.ruleId; m.lastSeen = d.t; m.cell = d.cell;
    if (d.rssi !== undefined) { m.samples.push({ t: d.t, rssi: d.rssi }); if (m.samples.length > 60) m.samples.shift(); }
    this.members.set(d.key, m);
    const current = this.vehicleOf(d.key);
    if (current) {
      // Re-check once enough RSSI history exists: a member whose signal moves against every other member leaves the group.
      const others = current.members.filter(o => o.key !== d.key); const rs = others.map(o => rssiCorrelation(o.samples, m.samples));
      if (rs.length && rs.every(r => r !== null && r < MIN_CORR)) {
        current.members = others; if (current.members.length < 2) { this.vehicles.delete(current.id); return undefined; }
        this.refresh(current, d.t); return undefined;
      }
      return this.refresh(current, d.t);
    }
    // Find partners: same cell, within the window, independent evidence, compatible RSSI.
    const partners = [...this.members.values()].filter(o => o.key !== d.key && o.cell === d.cell && Math.abs(o.lastSeen - d.t) <= travel().groupWindowMs && independent(o, m) && this.compatible(o, m));
    if (!partners.length) return undefined;
    const target = partners.map(p => this.vehicleOf(p.key)).find(v => v && v.cell === d.cell);
    if (target) { target.members.push(m); return this.refresh(target, d.t); }
    const best = partners.sort((a, b) => b.confidence - a.confidence)[0];
    const v: Vehicle = { id: `veh-${++this.seq}`, cell: d.cell, firstSeen: Math.min(best.lastSeen, d.t), lastSeen: d.t, members: [best, m], confidence: 0, baseConfidence: 0, boost: 0, rssiCorrelated: false, radios: [] };
    this.vehicles.set(v.id, v); this.everFormed++;
    return this.refresh(v, d.t);
  }
  private compatible(a: VehicleMember, b: VehicleMember): boolean {
    const r = rssiCorrelation(a.samples, b.samples);
    if (r !== null) return r >= MIN_CORR;
    const ra = lastRssi(a), rb = lastRssi(b);
    return ra === undefined || rb === undefined || Math.abs(ra - rb) <= MAX_RSSI_SPREAD_DB;
  }
  private refresh(v: Vehicle, t: number): Vehicle {
    v.lastSeen = Math.max(v.lastSeen, t);
    let corr = false; for (let i = 0; i < v.members.length; i++) for (let j = i + 1; j < v.members.length; j++) { const r = rssiCorrelation(v.members[i].samples, v.members[j].samples); if (r !== null && r >= MIN_CORR) corr = true; }
    const c = combine(v.members, corr);
    Object.assign(v, { confidence: c.confidence, baseConfidence: c.base, boost: c.boost, rssiCorrelated: corr, radios: [...new Set(v.members.map(m => m.radio))] });
    const h = this.history.get(v.id);
    const hm = v.members.map(m => ({ radio: m.radio, ruleId: m.ruleId, gear: m.gear, dev: m.key }));
    this.history.set(v.id, { id: v.id, cell: v.cell, firstSeen: h?.firstSeen ?? v.firstSeen, lastSeen: v.lastSeen, members: hm, confidence: Math.max(h?.confidence ?? 0, v.confidence), baseConfidence: v.baseConfidence, boost: v.boost, rssiCorrelated: v.rssiCorrelated || !!h?.rssiCorrelated });
    return v;
  }
  vehicleOf(key: string): Vehicle | undefined { for (const v of this.vehicles.values()) if (v.members.some(m => m.key === key)) return v; return undefined; }
  list(now = Date.now()): Vehicle[] { this.prune(now); return [...this.vehicles.values()]; }
  get formed() { return this.everFormed; }
  private prune(now: number) {
    for (const [k, m] of this.members) if (now - m.lastSeen > travel().vehicleTtlMs) this.members.delete(k);
    for (const [id, v] of this.vehicles) { v.members = v.members.filter(m => this.members.has(m.key)); if (v.members.length < 2 || now - v.lastSeen > travel().vehicleTtlMs) this.vehicles.delete(id); }
  }
  clear() { this.members.clear(); this.vehicles.clear(); this.history.clear(); this.everFormed = 0; } // seq keeps counting so ids stay unique within a recording
}
