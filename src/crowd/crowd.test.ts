import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { aggregate, buildReport, validateReport, snapCell, toBucket, ALLOWED_FIELDS, TEST_KIND, BUCKET_MS, type CrowdReport } from './protocol';
import { CrowdClient } from './client';

const NOW = Date.UTC(2026, 9, 26, 22, 0, 0);
const tok = (n: number) => n.toString(16).padStart(32, '0');
const rep = (o: Partial<CrowdReport> = {}): CrowdReport => ({ cell: snapCell(40.1164, -88.2434), bucket: toBucket(NOW - 20 * 60_000), kind: 'body-camera', conf: 'med', reporter: tok(1), ...o });

describe('payload building', () => {
  it('only allowed fields, snapped cell, bucketed time', () => {
    const p = buildReport({ lat: 40.116412, lng: -88.243387, time: NOW + 123_456, kind: 'body-camera', confidence: 0.9, reporter: tok(7) });
    expect(Object.keys(p).sort()).toEqual([...ALLOWED_FIELDS].sort());
    expect(p.cell).toEqual(snapCell(40.116412, -88.243387)); expect(p.cell.lat).not.toBe(40.116412);
    expect(p.bucket % BUCKET_MS).toBe(0); expect(p.conf).toBe('high');
    const s = JSON.stringify(p);
    for (const f of ['sessionId', 'rssi', 'mac', 'name', 'address', 'accuracy', 'transcript', 'deviceId', 'serial']) expect(s.toLowerCase()).not.toContain(f.toLowerCase());
  });
  it('client sends nothing when sharing is off and strips extra match fields when on', async () => {
    const store: Record<string, string> = {}; (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
    const bodies: any[] = []; const c = new CrowdClient('x', (async (_u: any, i: any) => { bodies.push(JSON.parse(i.body)); return new Response('{}'); }) as any);
    const m: any = { kind: 'cew', confidence: 0.6, time: NOW, rssi: -80, sessionId: 'abc123' };
    expect(await c.report(m, { lat: 40.11, lng: -88.24 })).toBeNull(); expect(bodies).toHaveLength(0);
    c.sharing = true; await c.report(m, { lat: 40.11, lng: -88.24 }); await c.report(m, { lat: 40.11, lng: -88.24 });
    expect(bodies).toHaveLength(1); expect(Object.keys(bodies[0]).sort()).toEqual([...ALLOWED_FIELDS].sort());
    expect(JSON.stringify(bodies[0])).not.toContain('abc123');
  });
});

describe('validation', () => {
  const ok = () => JSON.parse(JSON.stringify(rep({ bucket: toBucket(NOW) })));
  it('accepts a good report', () => expect(validateReport(ok(), NOW).ok).toBe(true));
  it.each([
    ['extra field', { ...ok(), rssi: -70 }], ['off grid', { ...ok(), cell: { lat: 40.116412, lng: -88.243387 } }],
    ['outside US', { ...ok(), cell: snapCell(51.5, -0.12) }], ['future', { ...ok(), bucket: toBucket(NOW) + 2 * BUCKET_MS }],
    ['too old', { ...ok(), bucket: toBucket(NOW - 3600_000) }], ['unaligned', { ...ok(), bucket: NOW - 1 }],
    ['bad kind', { ...ok(), kind: 'phone' }], ['test kind w/o key', { ...ok(), kind: TEST_KIND }],
    ['bad conf', { ...ok(), conf: 0.9 }], ['bad token', { ...ok(), reporter: 'me@x.com' }], ['array', [1]],
  ])('rejects %s', (_n, b) => expect(validateReport(b, NOW).ok).toBe(false));
  it('test kind only with key', () => expect(validateReport({ ...ok(), kind: TEST_KIND }, NOW, { allowTest: true }).ok).toBe(true));
});

describe('delay + aggregation', () => {
  it('hides reports newer than the 12 min delay (and clamps delay to >=10)', () => {
    expect(aggregate([rep({ bucket: toBucket(NOW - 5 * 60_000) })], NOW)).toHaveLength(0);
    expect(aggregate([rep({ bucket: toBucket(NOW - 5 * 60_000) })], NOW, { delayMs: 0 })).toHaveLength(0);
    expect(aggregate([rep()], NOW)).toHaveLength(1);
    expect(aggregate([rep({ bucket: toBucket(NOW - 3 * 3600_000) })], NOW)).toHaveLength(0);
  });
  it('single medium reporter is faint; 2 distinct reporters or high conf is confirmed', () => {
    expect(aggregate([rep(), rep()], NOW)[0]).toMatchObject({ reporters: 1, confirmed: false });
    expect(aggregate([rep(), rep({ reporter: tok(2) })], NOW)[0]).toMatchObject({ reporters: 2, confirmed: true });
    expect(aggregate([rep({ conf: 'high' })], NOW)[0].confirmed).toBe(true);
  });
  it('output never exposes reporter tokens; test data hidden publicly', () => {
    const out = aggregate([rep(), rep({ kind: TEST_KIND })], NOW);
    expect(out).toHaveLength(1); expect(JSON.stringify(out)).not.toContain(tok(1));
  });
  it('API copy of protocol is identical', () => {
    expect(readFileSync('crowd-api/lib/protocol.ts', 'utf8')).toBe(readFileSync('src/crowd/protocol.ts', 'utf8'));
  });
});
