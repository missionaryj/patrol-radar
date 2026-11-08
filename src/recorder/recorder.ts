import { nativeDiagnostics, type NativeDiagnostics } from '../ble/nativeScanner';
import type { Advertisement } from '../ble/types';
import type { Match } from '../ble/matcher';
import { SIGNATURES, tierOf } from '../ble/signatures';
import { hits as ruleHits } from '../ble/matcher';
import { WIFI_RULES } from '../wifi/rules';
import { WIFI_TIERS } from '../wifi/tiers';
import { coarsen } from '../map/coarsen';
import type { WifiMatch } from '../wifi/rules';
import { classifyWifiTime, isSessionHash, wifiDev, type WifiIdentityKind, type WifiRetention, type WifiTimeSource } from '../wifi/identity';
import { evidenceQuality } from '../fusion/vehicles';

/**
 * Session recorder: keeps raw advert payloads for POLICE-GEAR MATCHES ONLY.
 * Privacy: unmatched adverts are dropped; device id is the per-session salted hash already
 * on the Advertisement; names are never stored; location is snapped to the 150 m grid here
 * (callers may pass precise coords, they are coarsened before storage);
 * printable-ASCII runs that look like serials/unit IDs (>=6 alnum chars incl. a digit) are masked.
 */
export const SCHEMA_VERSION = 6; // v6: Wi-Fi rows keep a per-session AP hash when the phone can tell access points apart, plus retention (session | buffered | history) and user sighting marks. Confidence tables are unchanged.
export const SCHEMA_V5 = 5; // v5 (1.0.23): confirmations[] (user 'saw police' / 'not police' taps) + health.native (scan supervisor counts)
export const SCHEMA_V4 = 4; // v3 (1.0.18): field-test label + per-signature hit summary (id, tier)
// v4 (1.0.19): records carry `radio` ('ble' | 'wifi'); Wi-Fi records may carry `tierRule`, `features` and `band`;
// top-level `vehicles` lists multi-signal vehicle groups. All additive: v1-v3 readers ignore the new fields.
/** Field-test ground truth the user sets during or after a session. */
export type FieldLabel = 'police-present' | 'not-present' | 'unsure';
export const FIELD_LABELS: FieldLabel[] = ['police-present', 'not-present', 'unsure'];
export const MAX_RECORDS = 5000;
const KEY = 'patrol-radar.recorder.v1';

export interface RecordEntry {
  t: number; dev: string; rssi?: number; txPower?: number;
  serviceUuids: string[];
  manufacturerData: { companyId: number; hex: string; masked: boolean }[];
  serviceData: { uuid: string; hex: string; masked: boolean }[];
  rules: string[]; bestRule: string; confidence: number; corroborated: boolean;
  cell?: { lat: number; lng: number; meters: number };
  /** v4+. Absent in older files (= 'ble' unless dev starts with "wifi:"). */
  radio?: 'ble' | 'wifi';
  /** v4+, Wi-Fi only: contextual tier rule that set the confidence, the features that fired it, and the band (no SSID/BSSID). */
  tierRule?: string; features?: string[]; band?: string;
  /** v6, Wi-Fi: 'ap' is one per-session salted hash. 'signature' means the phone could not tell access points apart. */
  identity?: WifiIdentityKind;
  /** v6, Wi-Fi: session = heard while recording; buffered = OS cache from before this scan; history = held before Record was on. */
  retention?: WifiRetention;
  /** v6: 'scan' uses the OS result time; 'received' is when the app got it because no usable scan time was present. */
  timeSource?: WifiTimeSource;
  /** v6: per-session hash of one radio (2.4/5 GHz pair). Not a vehicle id. Omitted unless it matches the hash shape. */
  radioId?: string;
}
/** v4+: one multi-signal vehicle group. Member ids are the per-session salted hashes already used in records. */
export interface VehicleRecord {
  id: string; firstSeen: number; lastSeen: number; cell: string;
  members: { dev: string; radio: 'ble' | 'wifi'; ruleId: string; gear: string }[];
  radios: ('ble' | 'wifi')[]; confidence: number; baseConfidence: number; boost: number; rssiCorrelated: boolean;
}
export const MAX_VEHICLES = 200;
/** v5+: one user confirmation tap on a detection card. Coarse cell only, per-session salted hash only, no precise location. */
export type ConfirmVerdict = 'police' | 'not-police';
export interface ConfirmationRecord {
  t: number; verdict: ConfirmVerdict; kind: 'device' | 'vehicle'; dev: string; radio?: 'ble' | 'wifi' | 'mixed';
  rules: string[]; tier: 'strong' | 'likely' | 'hint'; confidence: number; rssi?: number;
  cell?: { lat: number; lng: number; meters: number };
}
export const MAX_CONFIRMATIONS = 500;
/** v6: a user mark that a vehicle came into view or left. Time and coarse cell only. Not tied to a radio and not a vehicle count. */
export type SightingKind = 'vehicle-arrived' | 'vehicle-left';
export interface SightingRecord {
  t: number; kind: SightingKind;
  cell?: { lat: number; lng: number; meters: number };
}
export const MAX_SIGHTINGS = 200;
const WIFI_SAMPLE_CAP = 60;
/** v5+: latest native scan-supervisor report (counts + Android version class only). */
export interface NativeHealthRecord extends NativeDiagnostics { scanRestarts: { stall: number; periodic: number; screen: number; failed: number }; screenOffSec: number; quiet: boolean; baselinePerMin: number; android: { sdk: number; release: string; deviceClass: string } }
export type ScanEventKind = 'start' | 'stop' | 'restart' | 'stall' | 'auto-restart' | 'possible-patrol-car' | 'error' | 'permission-denied' | 'location-denied' | 'location-error' | 'screen-off' | 'screen-on' | 'scanner-quiet' | 'scanner-recovered';
export interface ScanEvent { t: number; kind: ScanEventKind; backend?: string; detail?: string }
/** Counts-only scan health. Never holds unmatched ids, names, payloads or coordinates. */
export interface Health {
  adverts: number; matched: number; distinctDevices: number; cellsVisited: number;
  firstAdvert?: number; lastAdvert?: number; longestGapMs: number; longestGapStart?: number;
  /** Current scan window (last start/restart and stop events). Gaps are only measured while a scan is running. */
  scanStart?: number; scanStop?: number;
  perMinute: Record<string, number>; // minute epoch (ms/60000) -> advert count
  events: ScanEvent[];
  fixes: number; accSum: number; accMin?: number; accMax?: number; accBuckets: { le20: number; le50: number; le100: number; gt100: number };
}
export const newHealth = (): Health => ({ adverts: 0, matched: 0, distinctDevices: 0, cellsVisited: 0, longestGapMs: 0, perMinute: {}, events: [], fixes: 0, accSum: 0, accBuckets: { le20: 0, le50: 0, le100: 0, gt100: 0 } });
export type Verdict = 'healthy' | 'scanner idle' | 'no adverts' | 'no location' | 'scanner errors' | 'not recorded';
interface State { recording: boolean; startedAt?: number; endedAt?: number; backend?: string; records: RecordEntry[]; dropped: number; vehicles?: VehicleRecord[]; health?: Health; confirmations?: ConfirmationRecord[]; sightings?: SightingRecord[]; native?: NativeHealthRecord; label?: { value: FieldLabel; setAt: number; updatedAt: number; duringSession: boolean } }
const MAX_EVENTS = 200; const SAVE_EVERY_MS = 2000; const IDLE_GAP_MS = 120_000;
const detailSafe = (d?: string) => d?.replace(/([0-9A-F]{2}:){5}[0-9A-F]{2}/gi, '[mac]').slice(0, 120);

/** Hex of payload with serial-like ASCII runs replaced by "**" per byte. */
export function maskedHex(dv: DataView): { hex: string; masked: boolean } {
  const b = Array.from({ length: dv.byteLength }, (_, i) => dv.getUint8(i));
  const mask = new Array(b.length).fill(false);
  let i = 0;
  while (i < b.length) {
    let j = i; while (j < b.length && /[0-9A-Za-z\-_]/.test(String.fromCharCode(b[j]))) j++;
    const run = String.fromCharCode(...b.slice(i, j));
    if (j - i >= 6 && /\d/.test(run)) for (let k = i; k < j; k++) mask[k] = true;
    i = j === i ? i + 1 : j;
  }
  return { hex: b.map((x, k) => (mask[k] ? '**' : x.toString(16).padStart(2, '0'))).join(''), masked: mask.some(Boolean) };
}

/** Dense per-minute timeline when the span fits MAX_TIMELINE_MIN; otherwise sparse (non-zero minutes only, every
 * one kept) plus zero markers at the edges of each gap. Previously a dense loop from startedAt stopped after
 * 1,440 entries, so a recorder started more than a day earlier dropped all of tonight's minutes. */
export const MAX_TIMELINE_MIN = 1440;
export function perMinuteTimeline(perMinute: Record<string, number>, lo: number | undefined, hi: number): { minute: string; adverts: number }[] {
  const iso = (m: number) => new Date(m * 60000).toISOString();
  const mins = Object.keys(perMinute).map(Number).sort((a, b) => a - b);
  if (lo === undefined) lo = mins[0]; if (lo === undefined) return [];
  hi = Math.max(hi, mins[mins.length - 1] ?? hi);
  if (hi - lo + 1 <= MAX_TIMELINE_MIN) { const out = []; for (let m = lo; m <= hi; m++) out.push({ minute: iso(m), adverts: perMinute[m] ?? 0 }); return out; }
  const keep = new Set<number>();
  for (const m of mins) { keep.add(m); if (!(m - 1 in perMinute) && m - 1 >= lo) keep.add(m - 1); if (!(m + 1 in perMinute) && m + 1 <= hi) keep.add(m + 1); }
  return [...keep].sort((a, b) => a - b).map(m => ({ minute: iso(m), adverts: perMinute[m] ?? 0 }));
}

/** Rule ids that matched this advert (same predicates as the matcher, including payload-shape gates). */
function rulesHit(adv: Advertisement, m: Match): string[] { return (m.hits ?? ruleHits(adv)).map(h => h.signature.id); }

interface WifiSample {
  t: number; rssi?: number; receivedAt: number; retention: WifiRetention; timeSource: WifiTimeSource;
  confidence: number; corroborated: boolean; rules: string[]; tierRule?: string; features?: string[]; band?: string;
  cell?: { lat: number; lng: number; meters: number };
}
interface WifiTrack {
  dev: string; identity: WifiIdentityKind; radioId?: string; ruleId: string; rules: string[];
  tierRule?: string; features?: string[]; band?: string; confidence: number; corroborated: boolean;
  cell?: { lat: number; lng: number; meters: number };
  first?: WifiSample; samples: WifiSample[];
}

const coarseCell = (loc?: { lat: number; lng: number }) => {
  if (!loc) return undefined;
  const g = coarsen(loc.lat, loc.lng, 150);
  return { lat: +g.lat.toFixed(5), lng: +g.lng.toFixed(5), meters: 150 };
};

export class SessionRecorder {
  s: State;
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage) {
    let loaded: State | undefined;
    try { const raw = storage?.getItem(KEY); if (raw) loaded = JSON.parse(raw); } catch { /* ignore */ }
    this.s = loaded ?? { recording: false, records: [], dropped: 0 };
    this.s.health ??= newHealth(); // v1 state upgrade
  }
  // in-memory only (never persisted/exported): de-dupe sets for distinct counts
  private seenDevs = new Set<string>(); private seenCells = new Set<string>();
  /** Wi-Fi observations since this scan session. Dropped on scan stop so a new salt cannot be linked. Not the export. */
  private wifiTracks = new Map<string, WifiTrack>();
  get health(): Health { return this.s.health!; }
  private evt(kind: ScanEventKind, backend?: string, detail?: string) {
    const h = this.health; const t = Date.now(); h.events.push({ t, kind, backend, detail: detailSafe(detail) });
    if (kind === 'start' || kind === 'restart' || kind === 'auto-restart') { h.scanStart = t; h.scanStop = undefined; }
    else if (kind === 'stop') h.scanStop = t;
    if (h.events.length > MAX_EVENTS) h.events.splice(0, h.events.length - MAX_EVENTS);
  }
  /** Log a scanner lifecycle event (works whether or not recording; kept with the session). */
  event(kind: ScanEventKind, backend?: string, detail?: string) { this.evt(kind, backend, detail); this.save(); }
  /** Location fix: accuracy only, coordinates are only used to count distinct 150 m cells in memory. */
  fix(accuracy: number, loc?: { lat: number; lng: number }) {
    if (!this.s.recording) return; const h = this.health;
    h.fixes++; h.accSum += accuracy; h.accMin = Math.min(h.accMin ?? accuracy, accuracy); h.accMax = Math.max(h.accMax ?? accuracy, accuracy);
    h.accBuckets[accuracy <= 20 ? 'le20' : accuracy <= 50 ? 'le50' : accuracy <= 100 ? 'le100' : 'gt100']++;
    if (loc) this.cell(loc);
    this.save();
  }
  private cell(loc: { lat: number; lng: number }) {
    const c = coarsen(loc.lat, loc.lng, 150); const k = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
    if (!this.seenCells.has(k)) { this.seenCells.add(k); this.health.cellsVisited++; }
  }
  private lastSave = 0;
  private tally(adv: Advertisement, matched: boolean) {
    const h = this.health; const t = adv.timestamp || Date.now();
    const ref = this.gapRef();
    if (ref !== undefined && t - ref > h.longestGapMs) { h.longestGapMs = t - ref; h.longestGapStart = ref; }
    h.firstAdvert ??= t; h.lastAdvert = Math.max(h.lastAdvert ?? t, t);
    h.adverts++; if (matched) h.matched++;
    const mk = String(Math.floor(t / 60000)); h.perMinute[mk] = (h.perMinute[mk] ?? 0) + 1;
    if (!this.seenDevs.has(adv.sessionId)) { this.seenDevs.add(adv.sessionId); h.distinctDevices++; }
  }
  /** Start of the current silent stretch within the active scan window: the last advert, or the scan (re)start if none since. */
  private gapRef(): number | undefined {
    const h = this.health; const ws = h.scanStart;
    if (h.lastAdvert !== undefined && (ws === undefined || h.lastAdvert >= ws)) return h.lastAdvert;
    return ws ?? this.s.startedAt;
  }
  /** Silence at the end of the session, counted only while scanning (a stop ends the window). */
  private tailGap(end: number): number {
    const h = this.health; const ref = this.gapRef(); if (ref === undefined) return 0;
    const stopAt = h.scanStop !== undefined && h.scanStop >= ref ? h.scanStop : end;
    return Math.max(0, Math.min(end, stopAt) - ref);
  }
  verdict(now = Date.now()): Verdict {
    const h = this.health; if (!this.s.startedAt) return 'not recorded';
    const end = this.s.recording ? now : (this.s.endedAt ?? now);
    if (h.adverts === 0) return h.events.some(e => e.kind === 'error' || e.kind === 'permission-denied') ? 'scanner errors' : 'no adverts';
    if (Math.max(h.longestGapMs, this.tailGap(end)) > IDLE_GAP_MS) return 'scanner idle';
    if (h.fixes === 0) return 'no location';
    return 'healthy';
  }
  healthLine(): string {
    const h = this.health; const v = this.verdict();
    const span = (this.s.startedAt ? ((this.s.recording ? Date.now() : this.s.endedAt ?? Date.now()) - this.s.startedAt) : 0) / 60000;
    const rate = span > 0 ? Math.round(h.adverts / span) : 0;
    return `Scan health: ${v} · ${h.adverts} adverts (${rate}/min) · ${h.distinctDevices} devices · ${h.fixes} fixes · ${h.cellsVisited} cells`;
  }
  healthExport() {
    const h = this.health; const iso = (t?: number) => (t === undefined ? null : new Date(t).toISOString());
    const end = this.s.recording ? Date.now() : (this.s.endedAt ?? Date.now());
    const tailGap = this.tailGap(end);
    const longest = Math.max(h.longestGapMs, tailGap);
    const mins = Object.keys(h.perMinute).map(Number).sort((a, b) => a - b);
    const lo = this.s.startedAt ? Math.floor(this.s.startedAt / 60000) : mins[0]; const hi = Math.floor(end / 60000);
    const timeline = perMinuteTimeline(h.perMinute, lo, hi);
    return {
      verdict: this.verdict(), advertsSeen: h.adverts, matchedAdverts: h.matched, unmatchedAdverts: h.adverts - h.matched,
      distinctDevicesSeen: h.distinctDevices, firstAdvert: iso(h.firstAdvert), lastAdvert: iso(h.lastAdvert),
      longestGapSec: Math.round(longest / 1000), longestGapStart: iso(longest === tailGap && longest > h.longestGapMs ? this.gapRef() : h.longestGapStart),
      advertsPerMinute: timeline, gridCellsVisited: h.cellsVisited, gridCellMeters: 150,
      location: { fixes: h.fixes, accuracyMeanM: h.fixes ? Math.round(h.accSum / h.fixes) : null, accuracyMinM: h.accMin ?? null, accuracyMaxM: h.accMax ?? null, accuracyBuckets: h.accBuckets },
      events: h.events.map(e => ({ ...e, t: new Date(e.t).toISOString() })),
      scanRestarts: this.s.native?.scanRestarts ?? null, screenOffSec: this.s.native?.screenOffSec ?? null, android: this.s.native?.android ?? null,
      nativeSupervisor: this.s.native ? { ...nativeDiagnostics(this.s.native), quiet: this.s.native.quiet, baselinePerMin: this.s.native.baselinePerMin } : null,
      note: 'counts only: no unmatched device ids, names, payloads or locations; distinct counts are de-duplicated in memory only (may over-count across an app reload)',
    };
  }
  /** Persisting re-serialises the whole session (up to ~1.5 MB at the 5000-record cap), so record adds are
   * coalesced to at most one write per SAVE_EVERY_MS. Lifecycle calls (start/stop/event/clear/flush) still write at once. */
  private saveTimer?: ReturnType<typeof setTimeout>; private lastRecSave = 0;
  private saveSoon() {
    if (Date.now() - this.lastRecSave >= SAVE_EVERY_MS) { this.lastRecSave = Date.now(); this.save(); return; }
    this.saveTimer ??= setTimeout(() => { this.saveTimer = undefined; this.save(); }, SAVE_EVERY_MS);
  }
  /** Write pending changes now (call on page hide / app pause). */
  flush() { this.save(); }
  private save() { if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = undefined; } this.lastSave = Date.now(); try { this.storage?.setItem(KEY, JSON.stringify(this.s)); } catch { /* quota */ } }
  get recording() { return this.s.recording; }
  get count() { return this.s.records.length; }
  get devices() { return new Set(this.s.records.map(r => r.dev)).size; }
  start(backend: string) { this.s.recording = true; this.s.startedAt ??= Date.now(); this.s.endedAt = undefined; this.s.backend = backend; this.flushWifiTracks(); this.save(); }
  stop() { this.s.recording = false; this.s.endedAt = Date.now(); this.save(); }
  /** Latest native supervisor report (replaces the previous one; counts are cumulative per scan session). */
  setNativeHealth(h: NativeHealthRecord) { this.s.native = { ...nativeDiagnostics(h), scanRestarts: { ...h.scanRestarts }, screenOffSec: h.screenOffSec, quiet: h.quiet, baselinePerMin: h.baselinePerMin, android: { ...h.android } }; this.saveSoon(); }
  get confirmations(): ConfirmationRecord[] { return this.s.confirmations ?? []; }
  /** Stores one confirmation tap. Precise location is coarsened to the grid cell here; nothing is uploaded. */
  confirm(c: Omit<ConfirmationRecord, 'cell' | 't'> & { t?: number }, loc?: { lat: number; lng: number }) {
    this.retainWifi(c.dev);
    const cell = coarseCell(loc);
    const rec: ConfirmationRecord = { t: c.t ?? Date.now(), verdict: c.verdict, kind: c.kind, dev: c.dev, ...(c.radio ? { radio: c.radio } : {}), rules: [...c.rules], tier: c.tier, confidence: +c.confidence.toFixed(2), ...(typeof c.rssi === 'number' ? { rssi: c.rssi } : {}), ...(cell ? { cell } : {}) };
    const list = (this.s.confirmations ??= []); list.push(rec); if (list.length > MAX_CONFIRMATIONS) list.shift(); this.save(); return rec;
  }
  get sightings(): SightingRecord[] { return this.s.sightings ?? []; }
  /**
   * User mark that a vehicle arrived or left. Stored with a timestamp and an optional coarse cell.
   * It is not attached to an access point and is not a claim that any radio was in that vehicle.
   */
  markSighting(kind: SightingKind, loc?: { lat: number; lng: number }, t = Date.now()): SightingRecord | undefined {
    if (kind !== 'vehicle-arrived' && kind !== 'vehicle-left') return undefined;
    const cell = coarseCell(loc);
    const rec: SightingRecord = { t, kind, ...(cell ? { cell } : {}) };
    const list = (this.s.sightings ??= []); list.push(rec); if (list.length > MAX_SIGHTINGS) list.shift(); this.save(); return rec;
  }
  /** Last verdict given for a session device / vehicle id (for the card's pressed state). */
  confirmedAs(dev: string): ConfirmVerdict | undefined { const l = this.confirmations; for (let i = l.length - 1; i >= 0; i--) if (l[i].dev === dev) return l[i].verdict; return undefined; }
  /** Set or change the field-test label (during or after the session). Passing null removes it. */
  setLabel(v: FieldLabel | null) {
    if (v === null) { delete this.s.label; this.save(); return; }
    if (!FIELD_LABELS.includes(v)) throw new Error('bad label');
    const now = Date.now(); this.s.label = { value: v, setAt: this.s.label?.setAt ?? now, updatedAt: now, duringSession: this.s.label?.duringSession ?? this.s.recording };
    this.save();
  }
  get label(): FieldLabel | undefined { return this.s.label?.value; }
  /** Per-signature hit summary for field evaluation: ids, tiers and counts only. */
  signatureHits() {
    const by = new Map<string, { records: number; devices: Set<string>; maxConfidence: number; best: number }>();
    for (const r of this.s.records) for (const id of r.tierRule ? [...r.rules, r.tierRule] : r.rules) {
      const d = by.get(id) ?? { records: 0, devices: new Set<string>(), maxConfidence: 0, best: 0 };
      d.records++; d.devices.add(r.dev); d.maxConfidence = Math.max(d.maxConfidence, r.confidence); if (r.bestRule === id) d.best++; by.set(id, d);
    }
    return [...by].map(([id, d]) => {
      const sig = SIGNATURES.find(s => s.id === id); const w = sig ? undefined : WIFI_RULES.find(x => x.id === id); const wt = sig || w ? undefined : WIFI_TIERS.find(x => x.id === id);
      const conf = sig?.baseConfidence ?? w?.baseConfidence ?? wt?.confidence ?? 0;
      return { id, radio: sig ? 'ble' : 'wifi', tier: sig ? tierOf(sig) : conf >= 0.85 ? 'strong' : conf >= 0.5 ? 'likely' : 'hint', status: sig?.status ?? w?.status ?? 'unverified', baseConfidence: conf, records: d.records, devices: d.devices.size, bestRuleRecords: d.best, maxConfidence: d.maxConfidence };
    }).sort((a, b) => b.records - a.records);
  }
  clear() { this.s = { recording: this.s.recording, startedAt: this.s.recording ? Date.now() : undefined, backend: this.s.backend, records: [], dropped: 0, health: newHealth() }; this.seenDevs.clear(); this.seenCells.clear(); this.wifiTracks.clear(); this.save(); }

  /** Returns true if stored. Unmatched adverts are always rejected. */
  add(adv: Advertisement, m: Match | null, loc?: { lat: number; lng: number }): boolean {
    if (!this.s.recording) return false;
    this.tally(adv, !!m);
    if (!m) { if (Date.now() - this.lastSave > 5000) { this.lastSave = Date.now(); this.save(); } return false; }
    const hits = rulesHit(adv, m);
    if (loc) this.cell(loc);
    const c = loc ? coarsen(loc.lat, loc.lng, 150) : undefined;
    const rec: RecordEntry = {
      t: adv.timestamp, dev: adv.sessionId, rssi: adv.rssi, txPower: adv.txPower,
      serviceUuids: [...adv.serviceUuids],
      manufacturerData: [...adv.manufacturerData].map(([companyId, dv]) => ({ companyId, ...maskedHex(dv) })),
      serviceData: [...adv.serviceData].map(([uuid, dv]) => ({ uuid, ...maskedHex(dv) })),
      rules: hits.length ? hits : [m.signature.id], bestRule: m.signature.id, confidence: m.confidence, corroborated: !!m.corroborated, radio: 'ble',
      cell: c && { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), meters: 150 },
    };
    this.s.records.push(rec);
    if (this.s.records.length > MAX_RECORDS) { this.s.records.splice(0, this.s.records.length - MAX_RECORDS); this.s.dropped++; }
    this.saveSoon();
    return true;
  }

  /**
   * Wi-Fi rule match. Stores rule ids, confidence, RSSI, the coarse cell and, when Android provided one,
   * the per-session salted access-point hash. Never an SSID, BSSID, MAC or payload.
   * Without a hash every access point of that signature shares one row group, marked identity 'signature'.
   */
  addWifi(m: WifiMatch & { tierRule?: string; features?: string[] }, rssi: number | undefined, loc?: { lat: number; lng: number }, t = Date.now(), band?: string): boolean {
    return this.noteWifi({ match: m, rssi, loc, receivedAt: t, band }).stored;
  }
  /**
   * Remember one access-point observation. While recording, append a row. Before recording, hold it in
   * memory and flush it as history when Record starts. A confirmation also keeps the earliest time.
   */
  noteWifi(n: {
    match: WifiMatch & { tierRule?: string; features?: string[] };
    rssi?: number; loc?: { lat: number; lng: number };
    receivedAt?: number; scanAt?: number; scanStartedAt?: number; cached?: boolean;
    apId?: string; radioId?: string; band?: string;
  }): { stored: boolean; dev: string; identity: WifiIdentityKind; t: number; retention: WifiRetention } {
    const receivedAt = n.receivedAt ?? Date.now();
    const idn = wifiDev(n.match.best.id, n.apId);
    const when = classifyWifiTime({ scanAt: n.scanAt, receivedAt, scanStartedAt: n.scanStartedAt, recordingStartedAt: this.s.startedAt, cached: n.cached, recording: this.s.recording });
    if (n.loc) this.cell(n.loc);
    const sample: WifiSample = {
      t: when.t, rssi: n.rssi, receivedAt, retention: when.retention, timeSource: when.timeSource,
      confidence: n.match.confidence, corroborated: n.match.corroborated, rules: [...n.match.rules],
      ...(n.match.tierRule ? { tierRule: n.match.tierRule, features: [...(n.match.features ?? [])] } : {}),
      ...(n.band ? { band: n.band } : {}), cell: coarseCell(n.loc),
    };
    const tr = this.wifiTracks.get(idn.dev) ?? {
      dev: idn.dev, identity: idn.identity, radioId: idn.identity === 'ap' && isSessionHash(n.radioId) ? n.radioId : undefined,
      ruleId: n.match.best.id, rules: [...n.match.rules], confidence: n.match.confidence, corroborated: n.match.corroborated, samples: [],
    };
    tr.confidence = Math.max(tr.confidence, n.match.confidence);
    tr.corroborated = tr.corroborated || n.match.corroborated;
    tr.rules = [...new Set([...tr.rules, ...n.match.rules])];
    if (!tr.radioId && idn.identity === 'ap' && isSessionHash(n.radioId)) tr.radioId = n.radioId;
    if (n.match.tierRule) tr.tierRule = n.match.tierRule;
    if (n.match.features) tr.features = [...n.match.features];
    if (n.band) tr.band = n.band;
    if (sample.cell) tr.cell = sample.cell;
    if (!tr.first || sample.t < tr.first.t) tr.first = sample;
    if (!tr.samples.some(s => s.t === sample.t)) {
      tr.samples.push(sample);
      tr.samples.sort((a, b) => a.t - b.t);
      if (tr.samples.length > WIFI_SAMPLE_CAP) {
        const first = tr.samples[0], last = tr.samples[tr.samples.length - 1];
        tr.samples = [first, ...tr.samples.slice(1, -1).slice(-(WIFI_SAMPLE_CAP - 2)), last];
      }
    }
    this.wifiTracks.set(idn.dev, tr);
    const stored = this.appendWifi(tr, sample, false);
    return { stored, dev: idn.dev, identity: idn.identity, t: sample.t, retention: sample.retention };
  }
  /** Drop in-memory Wi-Fi tracks at scan stop. A new scan has a new salt; do not carry ids across it. Already stored rows stay. */
  discardWifiSession() { this.wifiTracks.clear(); }
  private flushWifiTracks() {
    if (!this.s.recording) return;
    for (const tr of this.wifiTracks.values()) for (const s of tr.samples) this.appendWifi(tr, this.asRecorded(s), false);
  }
  /** Re-label a pre-recording sample now that Record is on. Buffered stays buffered. */
  private asRecorded(s: WifiSample): WifiSample {
    if (s.retention === 'buffered') return s;
    if (this.s.startedAt !== undefined && s.t < this.s.startedAt) return { ...s, retention: 'history' };
    return s;
  }
  /** Keep this access point's observed samples, including ones from before Record was on. */
  private retainWifi(dev: string) {
    const tr = this.wifiTracks.get(dev); if (!tr) return;
    const samples = tr.first && !tr.samples.some(s => s.t === tr.first!.t) ? [tr.first, ...tr.samples] : tr.samples;
    for (const s of samples) this.appendWifi(tr, s, true);
  }
  private appendWifi(tr: WifiTrack, s: WifiSample, force: boolean): boolean {
    if (!force && !this.s.recording) return false;
    if (this.s.records.some(r => r.radio === 'wifi' && r.dev === tr.dev && r.t === s.t)) return false;
    this.s.records.push({
      t: s.t, dev: tr.dev, rssi: s.rssi, serviceUuids: [], manufacturerData: [], serviceData: [], rules: [...s.rules], bestRule: tr.ruleId,
      confidence: s.confidence, corroborated: s.corroborated, cell: s.cell, radio: 'wifi', identity: tr.identity, retention: s.retention, timeSource: s.timeSource,
      ...(tr.radioId ? { radioId: tr.radioId } : {}),
      ...(s.tierRule ? { tierRule: s.tierRule, features: [...(s.features ?? [])] } : {}),
      ...(s.band ? { band: s.band } : {}),
    });
    if (this.s.records.length > MAX_RECORDS) { this.s.records.splice(0, this.s.records.length - MAX_RECORDS); this.s.dropped++; }
    this.saveSoon(); return true;
  }

  /** v4: upserts a vehicle group summary (coarse cell key, rule ids, radios, per-session hashes only). */
  vehicle(v: { id: string; cell: string; firstSeen: number; lastSeen: number; members: { key: string; radio: 'ble' | 'wifi'; ruleId: string; gear: string }[]; radios: ('ble' | 'wifi')[]; confidence: number; baseConfidence: number; boost: number; rssiCorrelated: boolean }): boolean {
    if (!this.s.recording) return false;
    const list = (this.s.vehicles ??= []); const id = `${this.s.startedAt ?? 0}:${v.id}`; const prev = list.find(x => x.id === id);
    const members = [...new Map([...(prev?.members ?? []), ...v.members.map(m => ({ dev: m.key, radio: m.radio, ruleId: m.ruleId, gear: m.gear }))].map(m => [m.dev, m])).values()];
    const rec: VehicleRecord = { id, cell: v.cell, firstSeen: Math.min(prev?.firstSeen ?? v.firstSeen, v.firstSeen), lastSeen: v.lastSeen, members, radios: [...new Set(members.map(m => m.radio))],
      confidence: Math.max(prev?.confidence ?? 0, v.confidence), baseConfidence: v.baseConfidence, boost: v.boost, rssiCorrelated: v.rssiCorrelated || !!prev?.rssiCorrelated };
    if (prev) Object.assign(prev, rec); else { list.push(rec); if (list.length > MAX_VEHICLES) list.shift(); }
    this.saveSoon(); return true;
  }
  get vehicles(): VehicleRecord[] { return this.s.vehicles ?? []; }

  summary() {
    const by = new Map<string, { dev: string; firstSeen: number; lastSeen: number; minRssi?: number; maxRssi?: number; adverts: number; rules: Set<string>; maxConfidence: number }>();
    for (const r of this.s.records) {
      const d = by.get(r.dev) ?? { dev: r.dev, firstSeen: r.t, lastSeen: r.t, adverts: 0, rules: new Set<string>(), maxConfidence: 0 };
      d.firstSeen = Math.min(d.firstSeen, r.t); d.lastSeen = Math.max(d.lastSeen, r.t); d.adverts++;
      if (r.rssi !== undefined) { d.minRssi = Math.min(d.minRssi ?? r.rssi, r.rssi); d.maxRssi = Math.max(d.maxRssi ?? r.rssi, r.rssi); }
      r.rules.forEach(x => d.rules.add(x)); d.maxConfidence = Math.max(d.maxConfidence, r.confidence); by.set(r.dev, d);
    }
    return [...by.values()].map(d => {
      const rows = this.s.records.filter(r => r.dev === d.dev);
      const wifi = rows.filter(r => r.radio === 'wifi');
      const identity = wifi.length && wifi.every(r => r.identity === wifi[0].identity) ? wifi[0].identity : undefined;
      const retentions = [...new Set(wifi.map(r => r.retention).filter((x): x is WifiRetention => !!x))];
      const sessionRows = wifi.filter(r => r.retention === 'session');
      const sessionFirstSeen = sessionRows.length ? new Date(Math.min(...sessionRows.map(r => r.t))).toISOString() : undefined;
      return { ...d, rules: [...d.rules], firstSeen: new Date(d.firstSeen).toISOString(), lastSeen: new Date(d.lastSeen).toISOString(), ...(identity ? { identity } : {}), ...(retentions.length ? { retentions } : {}), ...(sessionFirstSeen ? { sessionFirstSeen } : {}) };
    });
  }

  exportObject(appVersion: string) {
    return {
      header: {
        app: 'patrol-radar', appVersion, schemaVersion: SCHEMA_VERSION,
        sessionStart: this.s.startedAt ? new Date(this.s.startedAt).toISOString() : null,
        sessionEnd: new Date(this.s.endedAt ?? Date.now()).toISOString(),
        backend: this.s.backend ?? null, records: this.count, distinctDevices: this.devices, cap: MAX_RECORDS, truncated: this.s.dropped > 0,
        fieldLabel: this.s.label ? { value: this.s.label.value, setAt: new Date(this.s.label.setAt).toISOString(), updatedAt: new Date(this.s.label.updatedAt).toISOString(), setDuringSession: this.s.label.duringSession } : null,
        privacy: 'police-gear matches only; device ids are per-session salted hashes; a Wi-Fi row uses that hash when Android can tell access points apart, otherwise only the signature id (not one access point); no names, MACs, SSIDs or BSSIDs; location = 150 m grid cell; serial-like ASCII runs in payloads masked as **; health = aggregate counts only; sightings are the user\'s clock marks and are not a vehicle count',
      },
      health: this.healthExport(),
      signatureHits: this.signatureHits(),
      vehicles: this.vehicles.map(v => ({ ...v, firstSeen: new Date(v.firstSeen).toISOString(), lastSeen: new Date(v.lastSeen).toISOString(), notes: evidenceQuality(v) })),
      devices: this.summary(),
      confirmations: this.confirmations.map(c => ({ ...c, t: new Date(c.t).toISOString() })),
      sightings: this.sightings.map(s => ({ kind: s.kind, t: new Date(s.t).toISOString(), ...(s.cell ? { cell: s.cell } : {}) })),
      records: this.s.records,
    };
  }
}

/** Import any schema version (v1 files have no health block). */
export function parseExport(json: string) {
  const o = JSON.parse(json);
  if (o?.header?.app !== 'patrol-radar') throw new Error('not a patrol-radar session file');
  const v = Number(o.header.schemaVersion ?? 1);
  if (v > SCHEMA_VERSION) throw new Error(`schema v${v} is newer than this app (v${SCHEMA_VERSION})`);
  return { schemaVersion: v, header: o.header, health: (o.health ?? null) as ReturnType<SessionRecorder['healthExport']> | null, devices: o.devices ?? [], records: (o.records ?? []) as RecordEntry[], vehicles: (o.vehicles ?? []) as unknown[], sightings: (o.sightings ?? []) as unknown[] };
}
