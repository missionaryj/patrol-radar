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

import { parseNativeHealth, nativeDiagnostics } from './nativeScanner';
describe('native diagnostics allowlist', () => {
  it('preserves old counters and accepts aggregate native health', () => {
    const h = parseNativeHealth(JSON.stringify({ scanRestarts: { stall: 2 }, nativeCallbacks: 120,
      lastCallbackAgeMs: null, scanState: 'starting', lastRestartResult: 'pending', scanFailureCode: 6,
      requestedFiltered: false, mac: 'private', payload: 'private' }))!;
    expect(h.scanRestarts).toEqual({ stall: 2, periodic: 0, screen: 0, failed: 0 });
    expect(h.nativeCallbacks).toBe(120); expect(h.lastCallbackAgeMs).toBeNull();
    expect(h.lastRestartResult).toBe('pending'); expect(h.scanFailureCode).toBe(6);
    expect(JSON.stringify(h)).not.toContain('private');
    expect(parseNativeHealth('{}')?.nativeCallbacks).toBeUndefined();
  });
  it('rejects malformed values and free-text diagnostics', () => {
    expect(nativeDiagnostics({ nativeCallbacks: -1, nativeCallbacksPerMin: Infinity,
      scanState: 'private', lastRestartReason: 'private', lastRestartResult: 'private' } as any)).toEqual({});
    expect(parseNativeHealth('null')).toBeNull();
  });
});

import { vi } from 'vitest';
import { NativeScanner } from './nativeScanner';
it('retains listeners through a retry failure and forwards callback-confirmed recovery', async () => {
  const listeners = new Map<string, (event: any) => void>();
  const remove = vi.fn();
  const plugin = { requestScanPermissions: async () => ({ ble: 'granted' }),
    addListener: async (kind: string, cb: (event: any) => void) => { listeners.set(kind, cb); return { remove }; },
    start: vi.fn(), stop: vi.fn() };
  vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { PatrolScan: plugin } });
  try {
    const scanner = new NativeScanner(); scanner.wifi = false;
    scanner.onSupervisor = vi.fn(); scanner.onError = vi.fn(); scanner.onHealth = vi.fn();
    await scanner.start(() => {});
    listeners.get('state')!({ state: 'restart-failed', detail: 'Scan failed (code 6); retry scheduled' });
    listeners.get('state')!({ state: 'health', detail: JSON.stringify({ scanState: 'failed', scanFailureCode: 6 }) });
    expect(remove).not.toHaveBeenCalled(); expect(scanner.onError).not.toHaveBeenCalled();
    expect(scanner.onHealth).toHaveBeenCalledWith(expect.objectContaining({ scanState: 'failed', scanFailureCode: 6 }));
    listeners.get('state')!({ state: 'recovered', detail: 'Native callbacks resumed' });
    expect(scanner.onSupervisor).toHaveBeenLastCalledWith('recovered', 'Native callbacks resumed');
    scanner.stop(); expect(remove).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
