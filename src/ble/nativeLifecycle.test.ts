import { describe, expect, it, vi } from 'vitest';
import { NativeScanner } from './nativeScanner';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function mockNative() {
  const listeners = new Map<string, (event: any) => void>();
  const plugin = {
    requestScanPermissions: vi.fn(async () => ({ ble: 'granted' })),
    addListener: vi.fn(async (kind: string, cb: (event: any) => void) => {
      listeners.set(kind, cb);
      return { remove: vi.fn() };
    }),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    status: vi.fn(async () => ({ sessionActive: true, running: false })),
  };
  vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { PatrolScan: plugin } });
  return { plugin, listeners };
}
describe('Android scanner lifecycle', () => {
  it('cancels a pending permission prompt without starting native scanning', async () => {
    const { plugin } = mockNative();
    const prompt = deferred<{ ble: string }>();
    plugin.requestScanPermissions.mockImplementationOnce(() => prompt.promise);
    try {
      const scanner = new NativeScanner(); scanner.wifi = false;
      const starting = scanner.start(vi.fn());
      scanner.stop();
      prompt.resolve({ ble: 'granted' });
      await starting;
      expect(plugin.start).not.toHaveBeenCalled();
      expect(plugin.addListener).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalledOnce());
    } finally { vi.unstubAllGlobals(); }
  });

  it('queues Stop after a late native Start, before the next scan session', async () => {
    const { plugin } = mockNative();
    const first = deferred<void>();
    const actions: string[] = [];
    plugin.start.mockImplementationOnce(() => { actions.push('start A'); return first.promise; })
      .mockImplementationOnce(async () => { actions.push('start B'); });
    plugin.stop.mockImplementation(async () => { actions.push('stop'); });
    try {
      const a = new NativeScanner(); a.wifi = false;
      const startingA = a.start(vi.fn());
      await vi.waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
      a.stop();
      const b = new NativeScanner(); b.wifi = false;
      const startingB = b.start(vi.fn());
      await Promise.resolve();
      expect(actions).toEqual(['start A']);
      first.resolve();
      await startingA; await startingB;
      await vi.waitFor(() => expect(actions).toEqual(['start A', 'stop', 'start B']));
      b.stop();
      await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalledTimes(2));
    } finally { vi.unstubAllGlobals(); }
  });

  it('does not deliver async advert decoding or state callbacks after Stop', async () => {
    const { plugin, listeners } = mockNative();
    try {
      const scanner = new NativeScanner(); scanner.wifi = false;
      const got = vi.fn(), error = vi.fn();
      scanner.onError = error;
      await scanner.start(got);
      const advert = listeners.get('advert')!, state = listeners.get('state')!;
      advert({ id: 'n123', rssi: -50, uuids: [] });
      scanner.stop();
      await new Promise(resolve => setTimeout(resolve, 0));
      state({ state: 'stopped' });
      expect(got).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(await scanner.serviceStatus()).toEqual({ sessionActive: true, running: false });
      await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalled());
    } finally { vi.unstubAllGlobals(); }
  });

  it('ignores an old service shutdown but reports a native fatal error', async () => {
    const { plugin, listeners } = mockNative();
    try {
      const scanner = new NativeScanner(); scanner.wifi = false;
      const error = vi.fn(); scanner.onError = error;
      await scanner.start(vi.fn());
      listeners.get('state')!({ state: 'stopped' });
      expect(error).not.toHaveBeenCalled();
      listeners.get('state')!({ state: 'error', detail: 'Bluetooth scan stopped' });
      expect(error).toHaveBeenCalledWith('Bluetooth scan stopped');
      scanner.stop();
      await vi.waitFor(() => expect(plugin.stop).toHaveBeenCalled());
    } finally { vi.unstubAllGlobals(); }
  });
});
