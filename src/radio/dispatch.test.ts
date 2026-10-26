import { describe, it, expect, vi } from 'vitest';
import { parseTranscript } from './parser';
import { redact } from './redact';
import { CHAMPAIGN_FIXTURES, CHAMPAIGN_MOCK_FEED } from './fixtures/champaign';
import { DispatchPipeline } from './pipeline';
import { LocalLookupGeocoder, NominatimGeocoder, ChainGeocoder } from './geocoder';
import { MockSpeechToText, AudioTranscriptSource } from './sources';
import { coarsenPoint, publishable } from './privacy';
import { coarsen } from '../map/coarsen';

const PII = /2L14|Ortiz|Jacob|ABC 1234|Thompson|Maria|Lopez|555-0142|3U22|829 4471|Miller|Car 31|Deputy 7|Medic 4|Engine 161/i;

describe('champaign parser', () => {
  for (const f of CHAMPAIGN_FIXTURES) it(f.text, () => {
    const r = parseTranscript(f.text, 0);
    if (f.expect === null) return expect(r).toBeNull();
    expect(r).toMatchObject(f.expect);
  });
  it('parsed output contains no units, names, plates or phones', () => {
    expect(JSON.stringify(CHAMPAIGN_MOCK_FEED.map(t => parseTranscript(t, 0)))).not.toMatch(PII);
  });
});

describe('redaction', () => {
  it.each([
    ['plate Illinois ABC 1234 at Neil', 'ABC'], ['registration 829 4471', '4471'], ['Illinois XY 12345 northbound', '12345'],
    ['subject named Jacob Ortiz', 'Ortiz'], ['driver is Maria Lopez', 'Lopez'], ['Officer Thompson', 'Thompson'],
    ['Sgt. Miller', 'Miller'], ['unit 2L14', '2L14'], ['call back 217-555-0142', '555'], ['badge 4471', '4471'], ['Adam 12 copy', 'Adam 12'],
  ])('%s', (input, secret) => { expect(redact(input)).not.toContain(secret); });
  it('keeps street names', () => { expect(redact('respond to Green and Wright')).toContain('Green and Wright'); });
});

const fixed = new LocalLookupGeocoder();
describe('pipeline delay + coarsening', () => {
  it('holds incidents until >= 12 min old, then publishes coarsened', async () => {
    let now = 1_000_000_000;
    const p = new DispatchPipeline(fixed, () => {}, undefined, () => now);
    await p.handle({ kind: 'transcript', t: { text: 'respond to Green and Wright for a crash', timestamp: now, feed: 't' } });
    expect(p.visible()).toHaveLength(0); expect(p.pending()).toBe(1);
    now += 11 * 60_000; expect(p.visible()).toHaveLength(0);
    now += 60_001; const [inc] = p.visible();
    expect(inc).toBeTruthy();
    expect(inc.cell).toEqual(coarsenPoint({ lat: 40.1101, lng: -88.2290 }));
    expect(JSON.stringify(inc)).not.toMatch(/green|wright/i);
  });
  it('delay cannot be configured below 10 min', () => {
    const inc = { id: 'x', callType: 'c', cell: { lat: 0, lng: 0 }, firstSeen: 0, lastUpdate: 0, confidence: 1, reports: 1 };
    expect(publishable([inc], 9 * 60_000, { gridMeters: 200, publishDelayMs: 60_000 })).toHaveLength(0);
  });
  it('on scene merges and only raises confidence', async () => {
    let now = 0; const p = new DispatchPipeline(fixed, () => {}, undefined, () => now);
    await p.handle({ kind: 'transcript', t: { text: 'respond to Main and Race for a domestic disturbance', timestamp: 0, feed: 't' } });
    now = 13 * 60_000; const c0 = p.visible()[0].confidence;
    await p.handle({ kind: 'transcript', t: { text: 'On scene at Main and Race', timestamp: 60_000, feed: 't' } });
    const v = p.visible(); expect(v).toHaveLength(1); expect(v[0].confidence).toBeGreaterThan(c0); expect(v[0].callType).toBe('domestic disturbance');
  });
  it('grid is clamped 150-250 m and matches map coarsen at 200 m', () => {
    const p = { lat: 40.1101, lng: -88.229 };
    const a = coarsenPoint(p, 50), b = coarsenPoint(p, 150); expect(a).toEqual(b);
    const c = coarsen(p.lat, p.lng, 200), d = coarsenPoint(p, 200);
    expect(d.lat).toBeCloseTo(c.lat, 4);
    const dist = (x: typeof p, y: typeof p) => Math.hypot((x.lat - y.lat) * 111_320, (x.lng - y.lng) * 111_320 * Math.cos(x.lat * Math.PI / 180));
    expect(dist(p, coarsenPoint(p, 1000))).toBeLessThanOrEqual(250 * Math.SQRT1_2 + 1);
  });
  it('audio -> mock STT -> pipeline works and retains no transcript', async () => {
    let now = 0; const p = new DispatchPipeline(fixed, () => {}, undefined, () => now);
    let push!: (c: any) => void;
    p.add(new AudioTranscriptSource('a', { start: on => { push = on; return () => {}; } }, new MockSpeechToText()));
    push({ audio: new TextEncoder().encode('Car 9 respond to Neil and Kirby, theft, caller named Ann Lee').buffer, mime: 'text/plain', timestamp: 0, feed: 'a' });
    await new Promise(r => setTimeout(r, 10)); now = 20 * 60_000;
    expect(p.visible()).toHaveLength(1); expect(JSON.stringify(p)).not.toMatch(/Ann|Lee|Car 9|theft,/);
  });
});

describe('nominatim', () => {
  it('rate limits to >=1.1 s between requests and caches', async () => {
    let t = 0; const calls: number[] = [];
    const fetchFn = vi.fn(async () => { calls.push(t); return { json: async () => [{ lat: '40.1', lon: '-88.2' }] } as any; });
    const g = new NominatimGeocoder({ fetchFn, now: () => t, sleep: async ms => { t += ms; } });
    await Promise.all([g.geocode('Neil & Kirby'), g.geocode('Main & Race'), g.geocode('neil & kirby')]);
    expect(fetchFn).toHaveBeenCalledTimes(2); expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(1100);
  });
  it('chain prefers local lookup', async () => {
    const fetchFn = vi.fn(); const g = new ChainGeocoder([fixed, new NominatimGeocoder({ fetchFn: fetchFn as any })]);
    expect(await g.geocode('Wright & Green')).toBeTruthy(); expect(fetchFn).not.toHaveBeenCalled();
  });
});
