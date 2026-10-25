import { describe, it, expect } from 'vitest';
import { LiveDeviceTracker, bandFor, colorFor, offsetFor, opacityFor, REMOVE_MS } from './liveDevices';
import { SIGNATURES } from '../ble/signatures';
const m = (id: string) => ({ signature: SIGNATURES.find(s => s.id === id)!, confidence: 0.6, timestamp: 0, sessionId: 'x' });

describe('live devices', () => {
  it('bands', () => { expect([bandFor(-50), bandFor(-70), bandFor(-95)]).toEqual(['near', 'medium', 'far']); });
  it('colors by category', () => {
    expect(colorFor(m('axon-cid'))).toBe('#e53935'); expect(colorFor(m('moto-cid'))).toBe('#fb8c00'); expect(colorFor(null)).toBe('#8a9bb0');
  });
  it('deterministic, distinct offsets', () => {
    expect(offsetFor('abc')).toEqual(offsetFor('abc')); expect(offsetFor('abc')).not.toEqual(offsetFor('abd'));
    const o = offsetFor('abc'); expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(21);
  });
  it('smooths RSSI, fades and expires', () => {
    const t = new LiveDeviceTracker(0.5);
    t.update('k', -50, m('axon-cid'), 0); t.update('k', -90, null, 1000);
    const d = t.list(1000)[0];
    expect(d.rssi).toBe(-70); expect(d.kind).toBe('match'); expect(d.label).toContain('Axon');
    expect(opacityFor(0, 10_000)).toBe(1); expect(opacityFor(0, 90_000)).toBeLessThan(1);
    expect(t.list(1000 + REMOVE_MS + 1)).toHaveLength(0);
  });
  it('holds no raw identifiers', () => {
    const t = new LiveDeviceTracker(); t.update('a1b2c3d4', -60, null, 0);
    expect(JSON.stringify(t.list(0))).not.toMatch(/[0-9a-f]{2}:[0-9a-f]{2}/i);
  });
});
