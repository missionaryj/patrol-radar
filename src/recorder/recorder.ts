import type { Advertisement } from '../ble/types';
import type { Match } from '../ble/matcher';
import { SIGNATURES } from '../ble/signatures';
import { coarsen } from '../map/coarsen';

/**
 * Session recorder: keeps raw advert payloads for POLICE-GEAR MATCHES ONLY.
 * Privacy: unmatched adverts are dropped; device id is the per-session salted hash already
 * on the Advertisement; names are never stored; location is snapped to the 150 m grid here
 * (callers may pass precise coords, they are coarsened before storage);
 * printable-ASCII runs that look like serials/unit IDs (>=6 alnum chars incl. a digit) are masked.
 */
export const SCHEMA_VERSION = 1;
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
interface State { recording: boolean; startedAt?: number; endedAt?: number; backend?: string; records: RecordEntry[]; dropped: number; }

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
  }
  private save() { try { this.storage?.setItem(KEY, JSON.stringify(this.s)); } catch { /* quota */ } }
  get recording() { return this.s.recording; }
  get count() { return this.s.records.length; }
  get devices() { return new Set(this.s.records.map(r => r.dev)).size; }
  start(backend: string) { this.s.recording = true; this.s.startedAt ??= Date.now(); this.s.endedAt = undefined; this.s.backend = backend; this.save(); }
  stop() { this.s.recording = false; this.s.endedAt = Date.now(); this.save(); }
  clear() { this.s = { recording: this.s.recording, startedAt: this.s.recording ? Date.now() : undefined, backend: this.s.backend, records: [], dropped: 0 }; this.save(); }

  /** Returns true if stored. Unmatched adverts are always rejected. */
  add(adv: Advertisement, m: Match | null, loc?: { lat: number; lng: number }): boolean {
    if (!this.s.recording || !m) return false;
    const hits = rulesHit(adv).filter(id => SIGNATURES.find(s => s.id === id)!.rule.kind !== 'payloadAscii' || id === m.signature.id);
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
        privacy: 'police-gear matches only; device ids are per-session salted hashes; no names/MACs; location = 150 m grid cell; serial-like ASCII runs in payloads masked as **',
      },
      devices: this.summary(),
      records: this.s.records,
    };
  }
}
