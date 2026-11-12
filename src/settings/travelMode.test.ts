import { describe, it, expect, afterEach } from 'vitest';
import { PROFILES, travel, setTravelMode, loadTravelMode, TRAVEL_KEY } from './travelMode';
import { bandFor, bandRadius, LiveDeviceTracker } from '../map/liveDevices';
import { rangeFromRssi } from '../fusion/localize';
import { GearFusion } from '../fusion/gearFusion';
import { style3d, PALETTE } from '../map/palette';
import { toGeoJSON, circlePoly } from '../map/map3d';
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
afterEach(() => setTravelMode('car', undefined));
describe('travel mode', () => {
  it('defaults to car and persists only the choice', () => {
    const s = mem(); expect(loadTravelMode(s)).toBe('car'); expect(travel()).toBe(PROFILES.car);
    setTravelMode('foot', s); expect(s.m.get(TRAVEL_KEY)).toBe('foot'); expect([...s.m.keys()]).toEqual([TRAVEL_KEY]);
    setTravelMode('car', undefined); expect(loadTravelMode(s)).toBe('foot');
    s.setItem(TRAVEL_KEY, 'junk'); expect(loadTravelMode(s)).toBe('car');
  });
  it('car keeps the previous tuned behaviour', () => {
    expect(bandFor(-60)).toBe('near'); expect(bandFor(-80)).toBe('medium'); expect(bandRadius('far')).toBe(60);
    expect(rangeFromRssi(-120, 'ble')).toBe(80); expect(rangeFromRssi(-120, 'wifi')).toBe(150);
  });
  it('on foot: shorter range, stricter bands, longer windows', () => {
    setTravelMode('foot', undefined);
    expect(bandFor(-81)).toBe('medium'); expect(bandFor(-83)).toBe('far'); expect(bandRadius('far')).toBeLessThan(PROFILES.car.bandRadiusM.far);
    expect(rangeFromRssi(-120, 'ble')).toBe(50);
    const f = PROFILES.foot, c = PROFILES.car;
    expect(f.groupWindowMs).toBeGreaterThan(c.groupWindowMs); expect(f.persistMinMs).toBeGreaterThan(c.persistMinMs);
    expect(f.smoothHalfWindowMs).toBeGreaterThan(c.smoothHalfWindowMs);
    const g = new GearFusion(); g.add({ cell: 'a', t: 0, gear: 'radio', ruleId: 'r' });
    expect(g.add({ cell: 'a', t: 45_000, gear: 'body-camera', ruleId: 'b' }).possiblePatrolCar).toBe(true);
  });
  it('on foot drops faint unknown devices but never police matches', () => {
    setTravelMode('foot', undefined); const t = new LiveDeviceTracker();
    t.update('u', -95, null, 0); expect(t.list(0)).toHaveLength(0);
    const m: any = { signature: { label: 'Axon', vendor: 'Axon', category: 'body-camera' }, confidence: 0.9 };
    t.update('p', -98, m, 0); expect(t.list(0).map(d => d.key)).toEqual(['p']);
  });
});
describe('map palette + 3D', () => {
  it('3D style has extruded buildings over slate land', () => {
    const st = style3d('dark'); const b = st.layers.find((l: any) => l.id === 'buildings-3d');
    expect(b.type).toBe('fill-extrusion'); expect(st.layers[0].paint['background-color']).toBe(PALETTE.dark.land);
  });
  it('mirror keeps own dot and converts rings', () => {
    const g = toGeoJSON({ pins: [{ lat: 40, lng: -88, color: '#e53935', r: 6, kind: 'dot' }, { lat: 40, lng: -88, color: '#f00', r: 0, ring: 30, kind: 'ring' }], me: { lat: 40.1, lng: -88.2, acc: 10 } });
    expect(g.me.features).toHaveLength(1); expect(g.pts.features).toHaveLength(1); expect(g.polys.features).toHaveLength(1);
    expect(circlePoly(40, -88, 10)).toHaveLength(25);
  });
});