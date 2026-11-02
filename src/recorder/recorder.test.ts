import { describe, it, expect } from 'vitest';
import { SessionRecorder, maskedHex, MAX_RECORDS, parseExport } from './recorder';
import { match } from '../ble/matcher';
import { SIGNATURES } from '../ble/signatures';
import type { Advertisement } from '../ble/types';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);
const cid = (SIGNATURES.find(s => s.rule.kind === 'companyId')!.rule as { id: number }).id;
const police = (sid = 'hash-abc'): Advertisement => ({ sessionId: sid, name: 'X60012345', rssi: -60, txPower: -8, manufacturerData: new Map([[cid, dv([1, 2, 3])]]), serviceUuids: [], serviceData: new Map(), timestamp: 1700000000000 });
const phone = (): Advertisement => ({ sessionId: 'hash-phone', name: 'Jordan iPhone', rssi: -50, manufacturerData: new Map([[0x004c, dv([0x10, 5])]]), serviceUuids: [], serviceData: new Map(), timestamp: 1 });
const PRECISE = { lat: 40.116421, lng: -88.243385 };

describe('SessionRecorder', () => {
  it('rejects unmatched adverts and does nothing when not recording', () => {
    const r = new SessionRecorder(mem());
    expect(r.add(police(), match(police()), PRECISE)).toBe(false);
    r.start('web');
    expect(match(phone())).toBeNull();
    expect(r.add(phone(), match(phone()), PRECISE)).toBe(false);
    expect(r.count).toBe(0);
  });
  it('stores matches without names, raw ids or precise coords', () => {
    const s = mem(); const r = new SessionRecorder(s); r.start('web');
    const raw = { ...police(), sessionId: 'hash-1' };
    expect(r.add(raw, match(raw), PRECISE)).toBe(true);
    const json = JSON.stringify(r.exportObject('test'));
    expect(json).not.toContain('X60012345');
    expect(json).not.toContain('40.116421'); expect(json).not.toContain('-88.243385');
    expect(JSON.stringify(r.s.records)).not.toMatch(/"name"|"id":|deviceId|"mac/i);
    const rec = r.s.records[0];
    expect(rec.dev).toBe('hash-1');
    expect(Math.abs(rec.cell!.lat - PRECISE.lat)).toBeLessThan(0.002);
    expect(rec.manufacturerData[0]).toEqual({ companyId: cid, hex: '010203', masked: false });
    expect(rec.txPower).toBe(-8);
    // persisted & reloaded
    expect(new SessionRecorder(s).count).toBe(1);
  });
  it('masks serial-like ascii in payloads', () => {
    const b = [0xff, ...Array.from('AB12345678', c => c.charCodeAt(0)), 0x00];
    const m = maskedHex(dv(b));
    expect(m.masked).toBe(true); expect(m.hex).toBe('ff' + '**'.repeat(10) + '00');
    expect(maskedHex(dv([0x41, 0x42, 0x43])).masked).toBe(false);
  });
  it('caps records and rolls up per device', () => {
    const r = new SessionRecorder(mem()); r.start('mock');
    for (let i = 0; i < MAX_RECORDS + 10; i++) { const a = { ...police(i % 2 ? 'a' : 'b'), rssi: -50 - (i % 30) }; r.add(a, match(a)); }
    expect(r.count).toBe(MAX_RECORDS);
    const o = r.exportObject('t');
    expect(o.header.truncated).toBe(true); expect(o.header.distinctDevices).toBe(2); expect(o.devices).toHaveLength(2);
    expect(o.devices[0].minRssi).toBeLessThan(o.devices[0].maxRssi!);
  });

  it('v2 health: counts unmatched without storing ids/names/coords', () => {
    const r = new SessionRecorder(mem()); r.start('native'); r.event('start', 'native');
    r.fix(12, PRECISE); r.fix(80, { lat: PRECISE.lat + 0.01, lng: PRECISE.lng });
    const now = Date.now();
    for (let i = 0; i < 5; i++) { const p = { ...phone(), sessionId: 'hash-phone' + (i % 3), timestamp: now + i * 1000 }; r.add(p, match(p), PRECISE); }
    const o = r.exportObject('t'); const h = o.health;
    expect(o.header.schemaVersion).toBe(2); expect(o.records).toHaveLength(0);
    expect(h.advertsSeen).toBe(5); expect(h.unmatchedAdverts).toBe(5); expect(h.distinctDevicesSeen).toBe(3);
    expect(h.gridCellsVisited).toBe(2); expect(h.location.fixes).toBe(2); expect(h.location.accuracyMeanM).toBe(46);
    expect(h.verdict).toBe('healthy'); expect(h.events[0].kind).toBe('start');
    expect(h.advertsPerMinute.reduce((a, b) => a + b.adverts, 0)).toBe(5);
    const json = JSON.stringify(o);
    expect(json).not.toContain('hash-phone'); expect(json).not.toContain('Jordan'); expect(json).not.toContain('40.116'); expect(json).not.toContain('1005');
  });
  it('ignores idle time before a scan restart (field file 2026-10-31: 14 min idle, then 921 adverts)', () => {
    const real = Date.now; let now = 1_800_000_000_000; Date.now = () => now;
    try {
      const r = new SessionRecorder(mem()); r.start('native'); r.event('start', 'native');
      now += 20_000; r.event('stop', 'native');
      now += 14 * 60_000; r.event('start', 'native');       // idle, not scanning
      now += 5_000; r.fix(3);
      for (let i = 0; i < 135; i++) { now += 1_000; r.add({ ...phone(), timestamp: now }, null); }
      now += 1_500; r.event('stop', 'native'); now += 2_000; r.stop();
      expect(r.verdict()).toBe('healthy');
      const h = r.exportObject('t').health!; expect(h.verdict).toBe('healthy'); expect(h.longestGapSec).toBeLessThan(10);
      // still flags a real silent stretch while scanning
      r.start('native'); r.event('start', 'native'); now += 3 * 60_000; expect(r.verdict()).toBe('scanner idle');
    } finally { Date.now = real; }
  });
  it('coalesces storage writes for bursts of matches, flushes on stop', () => {
    const s = mem(); let writes = 0; const set = s.setItem; s.setItem = (k, v) => { writes++; set(k, v); };
    const r = new SessionRecorder(s); r.start('native'); const w0 = writes;
    for (let i = 0; i < 500; i++) { const p = { ...police('d' + i), timestamp: Date.now() }; r.add(p, match(p)); }
    expect(writes - w0).toBeLessThanOrEqual(2);
    r.stop(); expect(new SessionRecorder(s).count).toBe(500);
  });
  it('verdicts and v1 import', () => {
    const r = new SessionRecorder(mem()); r.start('web');
    expect(r.verdict()).toBe('no adverts');
    r.event('permission-denied', 'web'); expect(r.verdict()).toBe('scanner errors');
    const p = { ...phone(), timestamp: Date.now() }; r.add(p, null); expect(r.verdict()).toBe('no location');
    r.s.health!.lastAdvert = Date.now() - 300_000; expect(r.verdict()).toBe('scanner idle');
    const v1 = parseExport(JSON.stringify({ header: { app: 'patrol-radar', schemaVersion: 1 }, devices: [], records: [] }));
    expect(v1.schemaVersion).toBe(1); expect(v1.health).toBeNull();
    expect(parseExport(JSON.stringify(r.exportObject('t'))).health?.advertsSeen).toBe(1);
    // old v1 localStorage state upgrades
    const s = mem(); s.setItem('patrol-radar.recorder.v1', JSON.stringify({ recording: true, records: [], dropped: 0 }));
    expect(new SessionRecorder(s).health.adverts).toBe(0);
  });
});
