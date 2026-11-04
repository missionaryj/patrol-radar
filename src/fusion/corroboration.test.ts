import { describe, it, expect } from 'vitest';
import { combine, corroborationText, type VehicleMember } from './vehicles';
const m = (confidence: number, gear: string, radio: 'ble' | 'wifi' = 'ble'): VehicleMember => ({ key: gear + confidence, radio, ruleId: gear, vendor: gear, gear, confidence, lastSeen: 0, samples: [] });
describe('vehicle corroboration', () => {
  it('a member above the 0.95 cap never yields a negative boost', () => {
    const c = combine([m(0.96, 'axon'), m(0.35, 'moto'), m(0.7, 'remote')], false);
    expect(c.boost).toBe(0); expect(c.confidence).toBe(0.96);
    expect(corroborationText({ baseConfidence: c.base, boost: c.boost, members: [1, 2, 3] })).toBe('best 96%');
  });
  it('shows a positive boost with the signal count', () => {
    const c = combine([m(0.85, 'axon'), m(0.35, 'moto')], false);
    expect(c.boost).toBeGreaterThan(0);
    expect(corroborationText({ baseConfidence: c.base, boost: c.boost, members: [1, 2] })).toMatch(/^best 85% · \+\d+ from 2 signals$/);
  });
  it('never prints "+-"', () => { expect(corroborationText({ baseConfidence: 0.96, boost: -0.01, members: [1] })).not.toContain('+-'); });
});
