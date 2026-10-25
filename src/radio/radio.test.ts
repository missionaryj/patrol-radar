import { describe, it, expect } from 'vitest';
import { parseTranscript, scrub } from './parser';
import { coarsenPoint, publishable } from './privacy';
import { IncidentMerger } from './incidentMerger';
import { FIXTURES } from './fixtures/transcripts';

describe('parser', () => {
  for (const f of FIXTURES) it(f.text, () => {
    const r = parseTranscript(f.text, 0);
    if (f.expect === null) return expect(r).toBeNull();
    expect(r).toMatchObject(f.expect);
  });
  it('never outputs unit ids or names', () => {
    const out = JSON.stringify(FIXTURES.map(f => parseTranscript(f.text, 0)));
    expect(out).not.toMatch(/2A12|4471|Johnson|Miller|Car 14/i);
  });
  it('scrub removes badge/unit/name', () => {
    expect(scrub('Officer Johnson badge 4471 unit 2A12')).not.toMatch(/Johnson|4471|2A12/);
  });
});

describe('privacy', () => {
  it('coarsens to a grid, clamped 150-250m', () => {
    const a = coarsenPoint({ lat: 41.8781, lng: -87.6298 }, 10); const b = coarsenPoint({ lat: a.lat + 0.0003, lng: a.lng - 0.0003 }, 10);
    expect(a).toEqual(b);
  });
  it('delays publication >= 10 min even if configured lower', () => {
    const inc = { id: 'x', callType: 'c', cell: { lat: 0, lng: 0 }, firstSeen: 0, lastUpdate: 0, confidence: 1, reports: 1 };
    expect(publishable([inc], 5 * 60_000, { gridMeters: 200, publishDelayMs: 0 })).toHaveLength(0);
    expect(publishable([inc], 11 * 60_000)).toHaveLength(0);
    expect(publishable([inc], 13 * 60_000)).toHaveLength(1);
  });
});

describe('merger', () => {
  const cell = { lat: 1, lng: 1 };
  it('on scene merges into the same incident and raises confidence', () => {
    const m = new IncidentMerger();
    const a = m.add({ callType: 'crash', status: 'dispatched', timestamp: 0 }, cell);
    const c0 = a.confidence;
    const b = m.add({ callType: 'unknown', status: 'onscene', timestamp: 60_000 }, cell);
    expect(b.id).toBe(a.id); expect(m.list()).toHaveLength(1);
    expect(b.confidence).toBeGreaterThan(c0); expect(b.lastUpdate).toBe(60_000);
  });
  it('separate cells or windows create separate incidents', () => {
    const m = new IncidentMerger(60_000);
    m.add({ callType: 'crash', status: 'dispatched', timestamp: 0 }, cell);
    m.add({ callType: 'crash', status: 'dispatched', timestamp: 0 }, { lat: 2, lng: 2 });
    m.add({ callType: 'crash', status: 'dispatched', timestamp: 10 * 60_000 }, cell);
    expect(m.list()).toHaveLength(3);
  });
});
