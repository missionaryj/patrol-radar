import { describe, it, expect } from 'vitest';
import { SessionRecorder, maskedHex, MAX_RECORDS } from './recorder';
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
});
