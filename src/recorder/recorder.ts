import type { Advertisement } from '../ble/types';
import type { Match } from '../ble/matcher';
import { SIGNATURES } from '../ble/signatures';
import { coarsen } from '../map/coarsen';
import type { WifiMatch } from '../wifi/rules';

/**
 * Session recorder: keeps raw advert payloads for POLICE-GEAR MATCHES ONLY.
 * Privacy: unmatched adverts are dropped; device id is the per-session salted hash already
 * on the Advertisement; names are never stored; location is snapped to the 150 m grid here
 * (callers may pass precise coords, they are coarsened before storage);
 * printable-ASCII runs that look like serials/unit IDs (>=6 alnum chars incl. a digit) are masked.
 */
export const SCHEMA_VERSION = 2;
export const MAX_RECORDS = 5000;
const KEY = 'patrol-radar.recorder.v1';

export interface RecordEntry {
  t: number; dev: string; rssi?: number; txPower?: number;
  serviceUuids: string[];
  manufacturerData: { companyId: number; hex: string; masked: boolean }[];
  serviceData: { uuid: string; hex: string; masked: boolean }[];
  rules: string[]; bestRule: string; confidence: number; corroborated: boolean;
  cell?: { lat: number; lng: number; meters: number };
}
export type ScanEventKind = 'start' | 'stop' | 'restart' | 'stall' | 'auto-restart' | 'possible-patrol-car' | 'error' | 'permission-denied' | 'location-denied' | 'location-error';
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
interface State { recording: boolean; startedAt?: number; endedAt?: number; backend?: string; records: RecordEntry[]; dropped: number; health?: Health }
const MAX_EVENTS = 200; const IDLE_GAP_MS = 120_000;
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

const uuid16 = (u: number) => `0000${u.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
function rulesHit(adv: Advertisement): string[] {
  return SIGNATURES.filter(s => {
    const r = s.rule;
    if (r.kind === 'companyId') return adv.manufacturerData.has(r.id);
    if (r.kind === 'serviceUuid16') return adv.serviceUuids.includes(uuid16(r.uuid)) || adv.serviceData.has(uuid16(r.uuid));
    if (r.kind === 'namePattern') return !!adv.name && r.pattern.test(adv.name);
    return true; // payloadAscii: matcher already decided; include if it was the best hit below
  }).map(s => s.id);
}

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
      note: 'counts only: no unmatched device ids, names, payloads or locations; distinct counts are de-duplicated in memory only (may over-count across an app reload)',
    };
  }
  private save() { try { this.storage?.setItem(KEY, JSON.stringify(this.s)); } catch { /* quota */ } }
  get recording() { return this.s.recording; }
  get count() { return this.s.records.length; }
  get devices() { return new Set(this.s.records.map(r => r.dev)).size; }
  start(backend: string) { this.s.recording = true; this.s.startedAt ??= Date.now(); this.s.endedAt = undefined; this.s.backend = backend; this.save(); }
  stop() { this.s.recording = false; this.s.endedAt = Date.now(); this.save(); }
  clear() { this.s = { recording: this.s.recording, startedAt: this.s.recording ? Date.now() : undefined, backend: this.s.backend, records: [], dropped: 0, health: newHealth() }; this.seenDevs.clear(); this.seenCells.clear(); this.save(); }

  /** Returns true if stored. Unmatched adverts are always rejected. */
  add(adv: Advertisement, m: Match | null, loc?: { lat: number; lng: number }): boolean {
    if (!this.s.recording) return false;
    this.tally(adv, !!m);
    if (!m) { if (Date.now() - this.lastSave > 5000) { this.lastSave = Date.now(); this.save(); } return false; }
    const hits = rulesHit(adv).filter(id => SIGNATURES.find(s => s.id === id)!.rule.kind !== 'payloadAscii' || id === m.signature.id);
    if (loc) this.cell(loc);
    const c = loc ? coarsen(loc.lat, loc.lng, 150) : undefined;
    const rec: RecordEntry = {
      t: adv.timestamp, dev: adv.sessionId, rssi: adv.rssi, txPower: adv.txPower,
      serviceUuids: [...adv.serviceUuids],
      manufacturerData: [...adv.manufacturerData].map(([companyId, dv]) => ({ companyId, ...maskedHex(dv) })),
      serviceData: [...adv.serviceData].map(([uuid, dv]) => ({ uuid, ...maskedHex(dv) })),
      rules: hits.length ? hits : [m.signature.id], bestRule: m.signature.id, confidence: m.confidence, corroborated: !!m.corroborated,
      cell: c && { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), meters: 150 },
    };
    this.s.records.push(rec);
    if (this.s.records.length > MAX_RECORDS) { this.s.records.splice(0, this.s.records.length - MAX_RECORDS); this.s.dropped++; }
    this.save();
    return true;
  }

  /** Wi-Fi rule match (Android). Stores ONLY rule ids, confidence, RSSI and the coarse cell: no SSID, BSSID or hash. */
  addWifi(m: WifiMatch, rssi: number | undefined, loc?: { lat: number; lng: number }, t = Date.now()): boolean {
    if (!this.s.recording) return false;
    if (loc) this.cell(loc);
    const c = loc ? coarsen(loc.lat, loc.lng, 150) : undefined;
    this.s.records.push({ t, dev: `wifi:${m.best.id}`, rssi, serviceUuids: [], manufacturerData: [], serviceData: [], rules: [...m.rules], bestRule: m.best.id,
      confidence: m.confidence, corroborated: m.corroborated, cell: c && { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), meters: 150 } });
    if (this.s.records.length > MAX_RECORDS) { this.s.records.splice(0, this.s.records.length - MAX_RECORDS); this.s.dropped++; }
    this.save(); return true;
  }

  summary() {
    const by = new Map<string, { dev: string; firstSeen: number; lastSeen: number; minRssi?: number; maxRssi?: number; adverts: number; rules: Set<string>; maxConfidence: number }>();
    for (const r of this.s.records) {
      const d = by.get(r.dev) ?? { dev: r.dev, firstSeen: r.t, lastSeen: r.t, adverts: 0, rules: new Set<string>(), maxConfidence: 0 };
      d.firstSeen = Math.min(d.firstSeen, r.t); d.lastSeen = Math.max(d.lastSeen, r.t); d.adverts++;
      if (r.rssi !== undefined) { d.minRssi = Math.min(d.minRssi ?? r.rssi, r.rssi); d.maxRssi = Math.max(d.maxRssi ?? r.rssi, r.rssi); }
      r.rules.forEach(x => d.rules.add(x)); d.maxConfidence = Math.max(d.maxConfidence, r.confidence); by.set(r.dev, d);
    }
    return [...by.values()].map(d => ({ ...d, rules: [...d.rules], firstSeen: new Date(d.firstSeen).toISOString(), lastSeen: new Date(d.lastSeen).toISOString() }));
  }

  exportObject(appVersion: string) {
    return {
      header: {
        app: 'patrol-radar', appVersion, schemaVersion: SCHEMA_VERSION,
        sessionStart: this.s.startedAt ? new Date(this.s.startedAt).toISOString() : null,
        sessionEnd: new Date(this.s.endedAt ?? Date.now()).toISOString(),
        backend: this.s.backend ?? null, records: this.count, distinctDevices: this.devices, cap: MAX_RECORDS, truncated: this.s.dropped > 0,
        privacy: 'police-gear matches only; device ids are per-session salted hashes; no names/MACs; location = 150 m grid cell; serial-like ASCII runs in payloads masked as **; health = aggregate counts only',
      },
      health: this.healthExport(),
      devices: this.summary(),
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
  return { schemaVersion: v, header: o.header, health: (o.health ?? null) as ReturnType<SessionRecorder['healthExport']> | null, devices: o.devices ?? [], records: (o.records ?? []) as RecordEntry[] };
}
