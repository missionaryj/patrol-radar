import { describe, it, expect } from 'vitest';
import { TrafficAlerter, DEFAULT_TC_SETTINGS, loadTcSettings, saveTcSettings, alertDistanceM, isAhead, alertsFor, roundDist, REPEAT_MS, type TcSettings } from './trafficAlerts';
import type { TcPoint } from '../map/trafficCamLayer';
const src = { id: 'osm', name: 'OSM', url: '', license: 'ODbL', last_updated: null, fetched: '' };
const cam = (lat: number, lng: number, type: TcPoint['type'] = 'red_light', dir?: number): TcPoint => ({ lat, lng, type, source: src, dir });
const S = (p: Partial<TcSettings> = {}): TcSettings => ({ ...structuredClone(DEFAULT_TC_SETTINGS), ...p });
const me = { lat: 41.9, lng: -87.65 };
const north = (m: number) => me.lat + m / 111_320;
describe('traffic camera alerts', () => {
  it('defaults: speed, red-light, school on; monitoring off; persists', () => {
    const d = loadTcSettings(undefined); expect(d.alerts).toBe(true); expect(d.alertTypes.monitor).toBe(false); expect(d.alertTypes.school_zone).toBe(true);
    const m = new Map<string, string>(); const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveTcSettings(S({ alerts: false, distance: 300, style: 'vibrate' }), st);
    const l = loadTcSettings(st); expect(l.alerts).toBe(false); expect(l.distance).toBe(300); expect(l.style).toBe('vibrate'); expect(m.get('pr.trafficcams')).toBe('1');
    expect(loadTcSettings({ getItem: k => k === 'pr.trafficcams' ? '0' : null }).show).toBe(false);
  });
  it('auto distance by travel mode and speed', () => {
    expect(alertDistanceM(S(), 'foot', 1.4)).toBe(100); expect(alertDistanceM(S(), 'car', null)).toBe(400);
    expect(alertDistanceM(S(), 'car', 10)).toBe(250); expect(alertDistanceM(S(), 'car', 25)).toBe(500); expect(alertDistanceM(S(), 'car', 40)).toBe(600);
    expect(alertDistanceM(S({ distance: 150 }), 'car', 30)).toBe(150);
  });
  it('alerts once for a camera ahead, not behind, and not again within 10 min', () => {
    const a = new TrafficAlerter(); const cams = [cam(north(250), me.lng), cam(north(-200), me.lng)];
    const r = a.check({ ...me, heading: 0, speed: 12, t: 0 }, cams, S(), 'car');
    expect(r?.cam.lat).toBeCloseTo(north(250)); expect(Math.round(r!.distM)).toBe(250);
    expect(a.check({ ...me, heading: 0, speed: 12, t: 60_000 }, cams, S(), 'car')).toBeNull();
    expect(a.check({ ...me, heading: 0, speed: 12, t: REPEAT_MS + 1 }, cams, S(), 'car')).not.toBeNull();
  });
  it('alerts off, hidden layer or hidden type means zero alerts', () => {
    const cams = [cam(north(100), me.lng)]; const f = { ...me, heading: 0, speed: 10, t: 0 };
    expect(new TrafficAlerter().check(f, cams, S({ alerts: false }), 'car')).toBeNull();
    expect(new TrafficAlerter().check(f, cams, S({ show: false }), 'car')).toBeNull();
    expect(new TrafficAlerter().check(f, cams, S({ types: { ...DEFAULT_TC_SETTINGS.types, red_light: false } }), 'car')).toBeNull();
    expect(new TrafficAlerter().check(f, [cam(north(100), me.lng, 'monitor')], S(), 'car')).toBeNull();
    expect(alertsFor(S(), 'speed')).toBe(true);
  });
  it('ahead check uses camera direction when known', () => {
    expect(isAhead(me, 0, cam(north(200), me.lng, 'speed', 0))).toBe(true);
    expect(isAhead(me, 0, cam(north(200), me.lng, 'speed', 180))).toBe(true);
    expect(isAhead(me, 0, cam(north(200), me.lng, 'speed', 90))).toBe(false);
    expect(isAhead(me, 90, cam(north(200), me.lng))).toBe(false);
  });
  it('derives heading from movement when GPS heading is missing', () => {
    const a = new TrafficAlerter(); a.check({ ...me, t: 0 }, [], S(), 'car');
    const h = a.heading({ lat: north(30), lng: me.lng, t: 2000 }); expect(h).toBeCloseTo(0, 0);
    expect(roundDist(248)).toBe('250 m'); expect(roundDist(42)).toBe('40 m');
  });
});
