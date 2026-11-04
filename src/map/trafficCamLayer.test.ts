import { describe, it, expect } from 'vitest';
import { tcInBounds, tcPopup, unpack, type TcIndex, type TcRow } from './trafficCamLayer';
// @ts-expect-error untyped build script
import { classifyOsm, dedupe, pack, build } from '../../scripts/fetch-traffic-cameras.mjs';
const idx: TcIndex = { generated: '', count: 2, tileDeg: 5, types: ['speed', 'red_light', 'school_zone', 'work_zone', 'monitor'], counts: { byType: {} }, tiles: {},
  sources: [{ id: 'osm', name: 'OpenStreetMap', url: 'https://osm.org', license: 'ODbL', last_updated: '2026-11-04', fetched: '2026-11-04' }] };
describe('traffic cameras', () => {
  it('classifies OSM tags', () => {
    expect(classifyOsm({ highway: 'speed_camera' })).toBe('speed');
    expect(classifyOsm({ enforcement: 'traffic_signals' })).toBe('red_light');
    expect(classifyOsm({ highway: 'speed_camera', note: 'School zone' })).toBe('school_zone');
    expect(classifyOsm({ highway: 'speed_camera', description: 'work zone' })).toBe('work_zone');
    expect(classifyOsm({ man_made: 'surveillance', 'surveillance:type': 'camera', surveillance: 'traffic' })).toBe('monitor');
    expect(classifyOsm({ man_made: 'surveillance', 'surveillance:type': 'ALPR', surveillance: 'traffic' })).toBeNull();
    expect(classifyOsm({ amenity: 'cafe' })).toBeNull();
  });
  it('dedupes within 30 m, official first, keeps distinct types', () => {
    const a = { type: 'speed', lat: 41.9, lon: -87.6, source: 'chicago_speed' };
    const out = dedupe([a, { ...a, lat: 41.9001, source: 'osm' }, { ...a, type: 'red_light', source: 'osm' }, { ...a, type: 'monitor', source: 'osm' }, { ...a, lat: 41.901, source: 'osm' }]);
    expect(out.map((p: any) => p.source + p.type)).toEqual(['chicago_speedspeed', 'osmred_light', 'osmspeed']);
  });
  it('packs, filters by bounds and renders popup with source + date', () => {
    const { index, tiles } = build([{ type: 'red_light', lat: 41.9255, lon: -87.6483, source: 'osm', id: 5, dir: 90 }], { osm: { name: 'OpenStreetMap', url: 'u', license: 'ODbL', last_updated: '2026-11-04', fetched: '2026-11-04' } });
    expect(index.count).toBe(1); const rows = tiles['40_-90'] as TcRow[]; expect(rows[0]).toEqual(pack({ type: 'red_light', lat: 41.9255, lon: -87.6483, source: 'osm', id: 5, dir: 90 }));
    const pts = tcInBounds([[-87.6, 41.9, 1, 0, 90, null, 5], [-80, 30, 0, 0]], idx, { south: 41, north: 42, west: -88, east: -87 });
    expect(pts).toHaveLength(1); expect(pts[0].type).toBe('red_light');
    const h = tcPopup(unpack([-87.6, 41.9, 0, 0, null, 25], idx)); expect(h).toContain('Automated speed camera'); expect(h).toContain('Limit 25 mph'); expect(h).toContain('Last updated: 2026-11-04'); expect(h).toContain('ODbL');
  });
});
