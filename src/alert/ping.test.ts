import { describe, it, expect } from 'vitest';
import { PingGate } from './ping';
const hit = (deviceKey: string, cell = 'c1', category = 'body-camera', matched = true) => ({ deviceKey, cell, category, matched });
describe('PingGate', () => {
  it('pings on first new match', () => { expect(new PingGate().check(hit('a'), 0)).toBe('normal'); });
  it('never pings unmatched devices (phones, earbuds)', () => { expect(new PingGate().check(hit('a', 'c1', 'x', false), 0)).toBeNull(); });
  it('does not repeat for the same device', () => { const g = new PingGate(); g.check(hit('a'), 0); expect(g.check(hit('a', 'c9'), 1e9)).toBeNull(); });
  it('does not repeat for the same cell within the window', () => {
    const g = new PingGate(45_000, 600_000); g.check(hit('a'), 0);
    expect(g.check(hit('b'), 100_000)).toBeNull(); expect(g.check(hit('c'), 700_000)).toBe('normal');
  });
  it('enforces global cooldown across cells', () => {
    const g = new PingGate(45_000); g.check(hit('a', 'c1'), 0);
    expect(g.check(hit('b', 'c2'), 10_000)).toBeNull(); expect(g.check(hit('c', 'c3'), 46_000)).toBe('normal');
  });
  it('fixed infrastructure gets a soft ping', () => { expect(new PingGate().check(hit('f', 'c1', 'fixed'), 0)).toBe('soft'); });
  it('reset clears state', () => { const g = new PingGate(); g.check(hit('a'), 0); g.reset(); expect(g.check(hit('a'), 1)).toBe('normal'); });
});
