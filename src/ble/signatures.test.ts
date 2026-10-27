import { describe, it, expect } from 'vitest';
import { match } from './matcher';
import { nativeFilters } from './nativeScanner';
import type { Advertisement } from './types';

const dv = (...b: number[]) => new DataView(new Uint8Array(b).buffer);
const u = (x: number) => `0000${x.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
const adv = (p: Partial<Advertisement>): Advertisement => ({ sessionId: 's', timestamp: 0, rssi: -70, manufacturerData: new Map(), serviceUuids: [], serviceData: new Map(), ...p });

describe('new signatures', () => {
  it('Yardarm CID', () => { const m = match(adv({ manufacturerData: new Map([[0x025f, dv(1)]]) })); expect(m?.signature.id).toBe('yardarm-cid'); expect(m!.confidence).toBe(0.6); });
  it('Motorola Solutions FE04 / FD8E', () => {
    expect(match(adv({ serviceUuids: [u(0xfe04)] }))?.signature.id).toBe('moto-fe04');
    expect(match(adv({ serviceData: new Map([[u(0xfd8e), dv(0)]]) }))?.signature.id).toBe('moto-fd8e');
  });
  it('Flock Penguin name -> fixed', () => { const m = match(adv({ name: 'Penguin-1234567890' })); expect(m?.signature.category).toBe('fixed'); });
  it('Flock FS Ext Battery name', () => expect(match(adv({ name: 'FS Ext Battery' }))?.signature.id).toBe('flock-fsbatt-name'));
  it('Flock XUNTONG CID is weak alone, corroborated with name', () => {
    expect(match(adv({ manufacturerData: new Map([[0x09c8, dv(1)]]) }))!.confidence).toBe(0.3);
    const m = match(adv({ name: 'Penguin-1234567890', manufacturerData: new Map([[0x09c8, dv(1)]]) }));
    expect(m!.corroborated).toBe(true); expect(m!.confidence).toBeGreaterThanOrEqual(0.85);
  });
  it('Penguin pattern is strict', () => { expect(match(adv({ name: 'Penguin-123' }))).toBeNull(); expect(match(adv({ name: 'Penguin Speaker' }))).toBeNull(); });
  it('native hardware filters include new IDs', () => {
    const f = nativeFilters();
    expect(f.companyIds).toEqual(expect.arrayContaining([0x025f, 0x09c8]));
    expect(f.serviceUuids).toEqual(expect.arrayContaining(['fe04', 'fd8e']));
  });
});

describe('consumer devices do not match', () => {
  const cases: [string, Partial<Advertisement>][] = [
    ['iPhone (Apple 0x004C nearby)', { manufacturerData: new Map([[0x004c, dv(0x10, 0x05, 0x01, 0x18, 0x44)]]) }],
    ['AirPods (Apple proximity pairing)', { name: 'AirPods Pro', manufacturerData: new Map([[0x004c, dv(0x07, 0x19, 0x01, 0x0e, 0x20)]]) }],
    ['Samsung phone/buds', { name: 'Galaxy Buds2', manufacturerData: new Map([[0x0075, dv(0x42, 0x09, 0x81)]]) }],
    ['Pixel (Google Fast Pair FE2C)', { name: 'Pixel 8', serviceUuids: [u(0xfe2c)], serviceData: new Map([[u(0xfe2c), dv(0x00, 0x01, 0x02)]]) }],
    ['Motorola Mobility phone (0x0008 / FC7C)', { name: 'moto g', manufacturerData: new Map([[0x0008, dv(1)]]), serviceUuids: [u(0xfc7c)] }],
    ['Microsoft Swift Pair', { manufacturerData: new Map([[0x0006, dv(1, 9, 0x20)]]) }],
  ];
  for (const [n, p] of cases) it(n, () => expect(match(adv(p))).toBeNull());
});
