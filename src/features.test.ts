import { describe, it, expect, vi } from 'vitest';
import { ephemeralId, rotateSalt } from './util/hash';
import { createScanner } from './ble';
import { perMinuteTimeline, SessionRecorder } from './recorder/recorder';
import { matchWifi, fuseWifi, WIFI_RULES } from './wifi/rules';
import { match } from './ble/matcher';
import { GearFusion } from './fusion/gearFusion';
import { ScanFusion, toWifiMatch, wifiAsMatch } from './session/extras';
import { StallWatchdog } from './ble/stallWatchdog';
import { FollowController } from './map/follow';
import { flockInBounds, tilesFor } from './map/flockLayer';
import { ScreenWake } from './util/wakeLock';
import { readFileSync, existsSync } from 'node:fs';

const adv = (o: any) => ({ sessionId: 's', manufacturerData: new Map(), serviceUuids: [], serviceData: new Map(), timestamp: 0, ...o });

describe('1. salt rotation + chart cap', () => {
  it('ids differ across sessions (rotateSalt / createScanner)', async () => {
    const a = await ephemeralId('AA:BB:CC'); expect(await ephemeralId('AA:BB:CC')).toBe(a);
    createScanner('mock'); const b = await ephemeralId('AA:BB:CC'); expect(b).not.toBe(a);
    rotateSalt(); expect(await ephemeralId('AA:BB:CC')).not.toBe(b);
  });
  it('timeline keeps tonight even when the recorder started > 1 day ago', () => {
    const lo = 1_000_000, hi = lo + 3000; const pm = { [hi - 2]: 5, [hi - 1]: 7 };
    const tl = perMinuteTimeline(pm, lo, hi);
    expect(tl.filter(x => x.adverts > 0).map(x => x.adverts)).toEqual([5, 7]);
    expect(perMinuteTimeline({ [lo + 1]: 3 }, lo, lo + 10)).toHaveLength(11); // dense when short
  });
  it('recorder export shows minutes beyond 1,440', () => {
    const r = new SessionRecorder(undefined as any); r.start('web');
    (r as any).s.startedAt = Date.now() - 3 * 86400_000; r.add(adv({ timestamp: Date.now() }) as any, null);
    expect(r.healthExport().advertsPerMinute.some((x: any) => x.adverts === 1)).toBe(true);
  });
});

describe('3. Wi-Fi rules', () => {
  it('matches the specified SSIDs/OUI and only returns rule ids', () => {
    expect(matchWifi('Axon12-5g')?.best.id).toBe('axon-fleet-ssid');
    expect(matchWifi('4521-5G')?.confidence).toBe(0.6);
    expect(matchWifi('IBR900-1a2')?.best.id).toBe('cradlepoint-ssid');
    expect(matchWifi('R1900')?.best.role).toBe('vehicle-router');
    expect(matchWifi('home', '00:30:44:12:34:56')?.best.id).toBe('cradlepoint-oui');
    const both = matchWifi('IBR1700-abc', '00-30-44-aa-bb-cc')!; expect(both.rules).toEqual(['cradlepoint-ssid', 'cradlepoint-oui']); expect(both.confidence).toBe(0.51);
    expect(matchWifi('Flock-ABC123')?.confidence).toBe(0.7);
    expect(matchWifi('flock-abc')).toBeNull(); // case-sensitive
    expect(matchWifi('NETGEAR-5G')).toBeNull(); expect(matchWifi('12-5g')).toBeNull();
    expect(JSON.stringify(matchWifi('Axon12-5g'))).not.toContain('Axon12');
  });
  it('fuses native rule ids and drops unknown ids', () => { expect(fuseWifi(['bogus'])).toBeNull(); expect(fuseWifi(['flock-ssid'])!.best.category).toBe('fixed'); });
  it('recorder stores only rule ids for Wi-Fi', () => {
    const r = new SessionRecorder(undefined as any); r.start('native');
    r.addWifi(matchWifi('Axon7-5g')!, -60, { lat: 40.11, lng: -88.24 });
    const s = JSON.stringify(r.exportObject('t')); expect(s).toContain('axon-fleet-ssid'); expect(s).not.toContain('Axon7');
  });
  it('xuntong stays weak unless a Flock name appears', () => {
    const x = new Map([[0x09c8, new DataView(new ArrayBuffer(1))]]);
    expect(match(adv({ manufacturerData: x }) as any)!.confidence).toBe(0.3);
    expect(match(adv({ manufacturerData: x, serviceUuids: ['00003100-0000-1000-8000-00805f9b34fb'] }) as any)!.corroborated).toBe(false);
    expect(match(adv({ manufacturerData: x, name: 'FS Ext Battery' }) as any)!.confidence).toBeGreaterThanOrEqual(0.85);
  });
  it('android rule patterns are shipped to native', () => { expect(WIFI_RULES).toHaveLength(4); });
});

describe('4. possible patrol car', () => {
  it('flags >=2 gear types in one cell within 30 s', () => {
    const f = new GearFusion();
    expect(f.add({ cell: 'a', t: 0, gear: 'body-camera', ruleId: 'axon-cid' }).possiblePatrolCar).toBe(false);
    expect(f.add({ cell: 'b', t: 1000, gear: 'vehicle-router', ruleId: 'cradlepoint-ssid' }).possiblePatrolCar).toBe(false);
    expect(f.add({ cell: 'a', t: 20_000, gear: 'vehicle-camera', ruleId: 'axon-fleet-ssid' }).possiblePatrolCar).toBe(true);
    expect(f.add({ cell: 'a', t: 60_000, gear: 'radio', ruleId: 'moto-cid' }).possiblePatrolCar).toBe(false); // window expired
    expect(f.add({ cell: 'c', t: 61_000, gear: 'fixed-camera', ruleId: 'flock-ssid' }).possiblePatrolCar).toBe(false);
  });
  it('Flock SSID boosts a xuntong hit in the same cell', () => {
    const sf = new ScanFusion(); const loc = { lat: 40.1, lng: -88.2 };
    sf.wifi(toWifiMatch({ id: 'w', rules: ['flock-ssid'] })!, loc, 1000);
    const m = match(adv({ manufacturerData: new Map([[0x09c8, new DataView(new ArrayBuffer(1))]]), timestamp: 2000 }) as any)!;
    expect(ScanFusion.boostFlock(m, sf.ble(m, loc, 2000)).confidence).toBe(0.75);
    const wm = wifiAsMatch(toWifiMatch({ id: 'w', rules: ['axon-fleet-ssid'] })!, { id: 'w', rules: [] }); expect(wm.signature.category).toBe('vehicle');
  });
});

describe('2. stall watchdog + wake lock', () => {
  it('fires after 20 s of silence, on hide, and on resume', () => {
    let t = 0; const ev: string[] = []; const d = new StallWatchdog(r => ev.push(r), 20_000, () => t);
    d.start(); t = 10_000; d.check(); expect(ev).toEqual([]); t = 21_000; d.check(); d.check(); expect(ev).toEqual(['no-adverts']);
    d.advert(); d.visibility(true); t = 99_000; d.check(); d.visibility(false); expect(ev).toEqual(['no-adverts', 'hidden', 'resumed']); d.stop();
  });
  it('wake lock acquires where supported', async () => {
    const rel = vi.fn(async () => {}); const w = new ScreenWake({ wakeLock: { request: async () => ({ release: rel }) } });
    expect(await w.acquire()).toBe(true); await w.release(); expect(rel).toHaveBeenCalled();
    expect(await new ScreenWake({}).acquire()).toBe(false);
  });
});

describe('5. follow-me', () => {
  it('pauses on manual pan, resumes on recenter', () => {
    const ch: boolean[] = []; const f = new FollowController(true, x => ch.push(x));
    expect(f.onFix()).toBe(true); f.userPanned(); expect(f.onFix()).toBe(false); f.resume(); expect(f.onFix()).toBe(true); expect(ch).toEqual([false, true]);
  });
});

describe('6. Flock mapped layer data', () => {
  const dir = 'public/data/flock/';
  it('index + tiles are consistent and attributed', () => {
    if (!existsSync(dir + 'index.json')) return;
    const idx = JSON.parse(readFileSync(dir + 'index.json', 'utf8'));
    expect(idx.attribution).toContain('OpenStreetMap contributors'); expect(idx.count).toBeGreaterThan(1000);
    expect(Object.values(idx.tiles).reduce((a: number, b: any) => a + b, 0)).toBe(idx.count);
    const keys = tilesFor(idx, { south: 40.0, west: -88.4, north: 40.2, east: -88.1 }); expect(keys).toEqual(['40_-90']);
    const t = JSON.parse(readFileSync(`${dir}${keys[0]}.geojson`, 'utf8'));
    expect(flockInBounds(t, { south: 39, west: -90, north: 41, east: -87 }).length).toBeGreaterThan(0);
  });
});
