import { describe, it, expect } from 'vitest';
import { pickDefaultBackend } from './detect';
import { toEvent, nativeFilters } from './nativeScanner';
import { normalizeEvent } from './normalize';
import { match } from './matcher';

describe('native backend', () => {
  it('is picked inside the Capacitor Android app', () => {
    const g = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } };
    expect(pickDefaultBackend({ userAgent: 'Android', bluetooth: { requestLEScan() {} } }, g)).toBe('native');
    expect(pickDefaultBackend({ userAgent: 'Android', bluetooth: { requestLEScan() {} } }, {})).toBe('web');
  });
  it('builds hardware filters from signatures', () => {
    const f = nativeFilters();
    expect(f.serviceUuids).toContain('fc81');
    expect(f.companyIds.length).toBeGreaterThan(0);
  });
  it('feeds native adverts through the existing matcher without exposing the native id', async () => {
    const adv = await normalizeEvent(toEvent({ id: 'nabc123', rssi: -60, uuids: ['0000fc81-0000-1000-8000-00805f9b34fb'], mfr: {}, svc: {} }));
    expect(adv.sessionId).not.toContain('nabc123');
    expect(adv.serviceUuids[0]).toBe('0000fc81-0000-1000-8000-00805f9b34fb');
    expect(match(adv)?.signature.vendor).toBe('Axon');
  });
  it('parses native hex manufacturer data', async () => {
    const adv = await normalizeEvent(toEvent({ id: 'x', mfr: { '845': '0102' } }));
    expect(adv.manufacturerData.get(845)?.getUint8(1)).toBe(2);
  });
});
