import { describe, it, expect } from 'vitest';
import { LiveAnchors, REMOVE_MS } from './liveDevices';

describe('live hit pins stay where they were detected', () => {
  it('a match is anchored at its first detection position and does not follow the user', () => {
    const a = new LiveAnchors();
    // Real 2026-11-02 drive: Cradlepoint Wi-Fi hit at cell 40.1087,-88.24331, then the user drove on.
    const hit = a.anchor('wifi1', true, { lat: 40.1087, lng: -88.24331 }, 0);
    expect(hit).toEqual({ lat: 40.1087, lng: -88.24331 });
    for (let i = 1; i <= 10; i++) expect(a.anchor('wifi1', true, { lat: 40.1087 + i * 0.002, lng: -88.24331 }, i * 1000)).toEqual(hit);
  });
  it('unknown devices are user-relative (no anchor)', () => { const a = new LiveAnchors(); expect(a.anchor('u', false, { lat: 1, lng: 2 })).toBeNull(); expect(a.has('u')).toBe(false); });
  it('anchors expire with the device and clear on stop', () => {
    const a = new LiveAnchors(); a.anchor('k', true, { lat: 1, lng: 1 }, 0);
    a.prune(REMOVE_MS - 1); expect(a.has('k')).toBe(true);
    a.prune(REMOVE_MS + 1); expect(a.has('k')).toBe(false);
    a.anchor('k', true, { lat: 1, lng: 1 }, 0); a.clear(); expect(a.anchor('k', true, { lat: 5, lng: 5 }, 0)).toEqual({ lat: 5, lng: 5 });
  });
  it('a re-seen hit keeps its anchor alive', () => {
    const a = new LiveAnchors(); a.anchor('k', true, { lat: 1, lng: 1 }, 0); a.anchor('k', true, { lat: 9, lng: 9 }, REMOVE_MS - 10);
    a.prune(REMOVE_MS + 50); expect(a.anchor('k', true, { lat: 9, lng: 9 }, REMOVE_MS + 50)).toEqual({ lat: 1, lng: 1 });
  });
});
