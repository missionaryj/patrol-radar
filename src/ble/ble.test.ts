import { describe, it, expect } from 'vitest';
import { normalizeEvent, normUuid } from './normalize';
import { match } from './matcher';
import { classify } from './errors';
import { isBluefy, pickDefaultBackend } from './detect';
import { ScanStats } from './stats';

describe('normalizeEvent', () => {
  it('handles Web Bluetooth Map shape', async () => {
    const a = await normalizeEvent({ device: { id: 'AA:BB', name: 'x' }, rssi: -60, uuids: ['0000fc81-0000-1000-8000-00805f9b34fb'],
      manufacturerData: new Map([[0x034d, new DataView(new Uint8Array([1]).buffer)]]), serviceData: new Map() });
    expect(match(a)?.signature.vendor).toBe('Axon');
    expect(a.sessionId).not.toContain('AA');
  });
  it('handles plain-object / hex-key / short-uuid shape (Bluefy-style fallback)', async () => {
    const a = await normalizeEvent({ id: 'dev1', rssi: -70, serviceUuids: ['FE6C'], manufacturerData: { '0x034D': [1, 2] },
      serviceData: { fe6c: Array.from(new TextEncoder().encode('BWCDEVICE')) } });
    expect(a.manufacturerData.has(0x034d)).toBe(true);
    expect(a.serviceUuids[0]).toBe(normUuid(0xfe6c));
    expect(match(a)!.confidence).toBeGreaterThan(0.9);
  });
  it('unmatched consumer device', async () => {
    expect(match(await normalizeEvent({ id: 'h', name: 'Headphones', manufacturerData: new Map([[0x004c, new DataView(new ArrayBuffer(1))]]) }))).toBeNull();
  });
});
describe('errors/detect/stats', () => {
  it('classifies permission errors', () => {
    expect(classify(Object.assign(new Error('User denied'), { name: 'NotAllowedError' })).kind).toBe('permission');
    expect(classify({ name: 'NotFoundError', message: 'User cancelled' }).kind).toBe('permission');
  });
  it('detects Bluefy', () => {
    expect(isBluefy({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Bluefy', bluetooth: {} })).toBe(true);
    expect(isBluefy({ userAgent: 'Mozilla/5.0 (iPhone)', bluetooth: undefined })).toBe(false);
    expect(pickDefaultBackend({ userAgent: 'Mozilla/5.0 (X11; Linux) Chrome', bluetooth: {} })).toBe('mock');
  });
  it('counts raw/unmatched', () => { const s = new ScanStats(); s.record(false); s.record(true); expect([s.raw, s.unmatched, s.matched]).toEqual([2, 1, 1]); });
});
import { propNames, findScanApis, probeReport } from './probe';
describe('probe', () => {
  class Proto { requestDevice() {} getAvailability() {} }
  class BT extends Proto { watchAdvertisements() {} }
  it('walks prototype chain', () => { expect(propNames(new BT())).toEqual(expect.arrayContaining(['requestDevice', 'watchAdvertisements', 'getAvailability'])); });
  it('finds scan/advert methods incl. Bluefy-ish globals', () => {
    const win: any = { navigator: { bluetooth: new Proto(), userAgent: 'x' }, BLENative: { startScan() {}, notifyAppState() {} } };
    expect(findScanApis(win).map(f => f.path)).toEqual(['window.BLENative.startScan']);
    expect(probeReport(win)).toContain('BLENative');
  });
});
