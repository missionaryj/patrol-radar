import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { countBuckets, filterCaption, heatPaint, heatPopup, topReasons, YEAR_BASE, BUCKET } from './stopHeatLayer';
// @ts-expect-error untyped build script
import { GRID_M, classifyReason, makeStop, snap, packBucket, HeatAgg, BeatSet, serialize, assertOutputClean, reasonIndex } from '../../scripts/stop-heat-lib.mjs';

describe('stop heat aggregate', () => {
  it('keeps the grid inside the 150–250 m band and off the raw point', () => {
    expect(GRID_M).toBeGreaterThanOrEqual(150); expect(GRID_M).toBeLessThanOrEqual(250);
    const raw = { lat: 40.0874, lng: -88.19005 };
    const s = snap(raw.lat, raw.lng);
    expect(s.lat).not.toBe(raw.lat);
    const dLat = (s.lat - raw.lat) * 111_320, dLng = (s.lng - raw.lng) * 111_320 * Math.cos(raw.lat * Math.PI / 180);
    expect(Math.hypot(dLat, dLng)).toBeLessThanOrEqual((GRID_M * Math.SQRT2) / 2 + 1);
    const mid = snap(39.1, -77.2);
    const a = snap(mid.lat + 0.00005, mid.lng + 0.00005), b = snap(mid.lat - 0.00005, mid.lng - 0.00005);
    expect(a.lat).toBe(b.lat); expect(a.lng).toBe(b.lng);
  });
  it('refuses person fields and keeps only a reason category', () => {
    expect(() => makeStop({ year: 2019, dow: 1, hour: 9, lat: 41.8, lng: -87.6, beatId: '', cite: 0, warn: 0, arrest: 0, reason: null, src: 0, officer_id: 'x' })).toThrow(/identifying/);
    expect(() => makeStop({ year: 2019, dow: 1, hour: 9, lat: 41.8, lng: -87.6, mapping_address: '1 Main' })).toThrow(/identifying|unknown/);
    expect(classifyReason('SPEEDING 26-34 MPH OVER LIMIT')).toBe(reasonIndex('speeding'));
    expect(classifyReason('LIGHT, TAIL LIGHTS REQUIRED')).toBe(reasonIndex('equipment'));
    expect(classifyReason('DISOBEY RED CIRCULAR STEADY SIGNAL STOP')).toBe(reasonIndex('signal'));
    expect(classifyReason('STOP AT STOP SIGN')).toBe(reasonIndex('stop sign'));
    expect(classifyReason('DRIVING ON SUSPENDED LICENSE')).toBe(reasonIndex('license'));
    expect(classifyReason('Not Applicable')).toBeNull();
  });
  it('counts a beat when the point is inside, otherwise a grid cell', () => {
    const ring = [[-88.2, 40.1], [-88.1, 40.1], [-88.1, 40.2], [-88.2, 40.2], [-88.2, 40.1]];
    const set = new BeatSet('t', 'Testville', () => 'Beat 1');
    set.add('1', [ring]);
    const agg = new HeatAgg();
    agg.addBeatSet(set); agg.finishIndex();
    const row = { cite: 0, warn: 0, arrest: 0, src: 0, beatId: '' };
    agg.add(makeStop({ ...row, year: 2019, dow: 1, hour: 9, lat: 40.15, lng: -88.15, beatId: '1', cite: 1, reason: reasonIndex('speeding') }), set);
    agg.add(makeStop({ ...row, year: 2019, dow: 2, hour: 22, lat: 41.9, lng: -87.6, warn: 1, reason: reasonIndex('equipment') }), set);
    expect(agg.mapped).toBe(2);
    expect(agg.units.get('t:1')?.n).toBe(1);
    const grid = [...agg.units.values()].find((u: { kind: string }) => u.kind === 'grid');
    expect(grid.n).toBe(1);
    const built = serialize(agg);
    assertOutputClean(built.beatFiles.get('t'));
    expect(JSON.stringify(built)).not.toMatch(/officer|mapping_address|subject_age|SPEEDING 26/);
  });
});

describe('stop heat filters and popup', () => {
  const year = 2019, tod = 2, dow = 1;
  const pack = (year - YEAR_BASE) * BUCKET + tod * 7 + dow;
  const b = [pack, 4, pack + 1, 1];
  const o = [pack, 3, 0, 1];
  const r = [year - YEAR_BASE, 0, 4];
  it('filters year, hour and weekday', () => {
    expect(countBuckets(b, o, { year, tod, dow }).n).toBe(4);
    expect(countBuckets(b, o, { year, tod, dow }).cite).toBe(3);
    expect(countBuckets(b, o, { year: 2018, tod: null, dow: null }).n).toBe(0);
    expect(countBuckets(b, o, { year: null, tod: 0, dow: null }).n).toBe(0);
    expect(countBuckets(b, o, { year: null, tod: null, dow: null }).n).toBe(5);
    expect(packBucket(year, tod, dow)).toBe(pack);
  });
  it('popup shows the count, share, reason and source, and names the cell size', () => {
    const html = heatPopup({
      title: 'Historical stops', count: countBuckets(b, o, { year, tod: null, dow: null }),
      reasons: topReasons(r, { year, tod: null, dow: null }, ['speeding']),
      filter: { year, tod: null, dow: null }, caption: filterCaption({ year, tod: null, dow: null }, [{ id: 'morning', label: 'Morning', hint: '8a–12p' }], ['Sun']),
      sources: [{ name: 'Stanford Open Policing Project — Chicago', url: 'https://openpolicing.stanford.edu/data/', license: 'ODC-BY 1.0', last_updated: '2023-02-01' }],
      gridM: 200,
    });
    expect(html).toContain('<b>5</b>'); expect(html).toContain('Citation 75%'); expect(html).toContain('speeding');
    expect(html).toContain('ODC-BY'); expect(html).toContain('200 m'); expect(html).toContain('uneven');
    expect(html).not.toMatch(/officer|badge|subject_age/);
    expect(heatPaint(1000).fillOpacity).toBeGreaterThan(heatPaint(1).fillOpacity);
  });
});

describe('stop heat processed files', () => {
  const dir = 'public/data/stop-heat/';
  it('index, beats and tiles attribute sources and contain no person fields', () => {
    expect(existsSync(dir + 'index.json')).toBe(true);
    const idx = JSON.parse(readFileSync(dir + 'index.json', 'utf8'));
    expect(idx.gridM).toBeGreaterThanOrEqual(150); expect(idx.gridM).toBeLessThanOrEqual(250);
    expect(idx.disclaimer).toMatch(/uneven/);
    expect(idx.attribution).toMatch(/Open Policing Project/);
    expect(idx.sources.some((s: { id: string }) => s.id === 'opp_chicago')).toBe(true);
    expect(idx.totals.mapped).toBeGreaterThan(1000);
    expect(idx.notMapped.some((g: { id: string }) => g.id === 'ct_stops')).toBe(true);
    const files = [dir + 'index.json', ...idx.beatFiles.map((f: string) => dir + f), ...Object.keys(idx.tiles).map((k: string) => `${dir}tiles/${k}.json`)];
    const banned = /officer_id|subject_age|subject_race|driver_city|driver_name|mapping_address|badge_no|date_of_birth|"ssn"|anonymous_house/;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text).not.toMatch(banned);
      JSON.parse(text);
    }
    expect(readdirSync(dir, { recursive: true }).some((f: string | Buffer) => String(f).endsWith('.csv') || String(f).endsWith('.zip'))).toBe(false);
    const beat = JSON.parse(readFileSync(dir + idx.beatFiles[0], 'utf8'));
    expect(beat.features.length).toBeGreaterThan(0);
    expect(beat.features[0].geometry.type).toMatch(/Polygon/);
    expect(beat.features[0].properties.b.length).toBeGreaterThan(0);
  });
});
