import { describe, it, expect, beforeEach } from 'vitest';
import { scoreWifi, gradeOf } from './tiers';
import { isApproach } from './context';
import { ScanFusion } from '../session/extras';
import { setTravelMode } from '../settings/travelMode';
import { SessionRecorder } from '../recorder/recorder';
import { parseNativeHealth } from '../ble/nativeScanner';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage; };
const T0 = Date.parse('2026-11-04T19:51:00Z');
const loc = (i: number) => ({ lat: 40.13 + i * 0.002, lng: -88.2 }); // moving north ~220 m per step

describe('Cradlepoint traveling-with-you pattern (2026-11-04 field test)', () => {
  beforeEach(() => setTravelMode('car', undefined));
  it('today\'s strong Cradlepoint (-95 -> -89 -> -62 -> -83 over ~90 s) now reaches likely', () => {
    const f = new ScanFusion(); const steps = [[0, -95], [30_000, -89], [65_000, -62], [95_000, -83]] as const;
    let last; steps.forEach(([dt, rssi], i) => { last = f.scoreWifi({ id: 'cp1', rssi, rules: ['cradlepoint-oui'] }, loc(i), T0 + dt); });
    expect(last!.tierRule).toBe('cradlepoint-traveling'); expect(last!.confidence).toBe(0.6); expect(gradeOf(last!.confidence)).toBe('likely');
  });
  it('the single weak -99/-97 SSID+OUI sighting stays a hint', () => {
    const f = new ScanFusion();
    f.scoreWifi({ id: 'cp2', rssi: -99, rules: ['cradlepoint-oui', 'cradlepoint-ssid'] }, loc(0), T0);
    const w = f.scoreWifi({ id: 'cp2', rssi: -97, rules: ['cradlepoint-oui', 'cradlepoint-ssid'] }, loc(0), T0 + 25_000)!;
    expect(w.confidence).toBe(0.45); expect(gradeOf(w.confidence)).toBe('hint');
  });
  it('a router that is always strong (fixed, parked next to us) does not get the approach feature', () => {
    expect(isApproach([{ t: 0, rssi: -60 }, { t: 30_000, rssi: -58 }])).toBe(false);
    expect(isApproach([{ t: 0, rssi: -95 }, { t: 200_000, rssi: -60 }])).toBe(false); // too slow
    expect(isApproach([{ t: 0, rssi: -92 }, { t: 60_000, rssi: -68 }])).toBe(true);
  });
  it('OUI + SSID + approach + persistence stacks to the 0.65 ceiling; police BLE still caps at 0.75', () => {
    expect(scoreWifi(['cradlepoint-oui', 'cradlepoint-ssid'], { approach: true, persistent: true })!.confidence).toBe(0.65);
    expect(scoreWifi(['cradlepoint-oui'], { approach: true })!.confidence).toBe(0.55);
    expect(scoreWifi(['cradlepoint-oui', 'cradlepoint-ssid'], { approach: true, persistent: true, blePolice: true, dualBand: true })!.confidence).toBe(0.75);
    expect(scoreWifi(['sierra-oui'], { approach: true, persistent: true })!.confidence).toBe(0.2); // other vendors unchanged
  });
});

describe('confirmations + native health in the debug export', () => {
  it('stores coarse cell, rule ids, tier and rssi; no precise location', () => {
    const r = new SessionRecorder(mem()); r.start('native');
    const c = r.confirm({ verdict: 'police', kind: 'device', dev: 'wifi:cp1', radio: 'wifi', rules: ['cradlepoint-oui', 'cradlepoint-traveling'], tier: 'likely', confidence: 0.6, rssi: -62 }, { lat: 40.123456, lng: -88.234567 });
    expect(c.cell!.meters).toBe(150); expect(c.cell!.lat).not.toBe(40.123456);
    expect(r.confirmedAs('wifi:cp1')).toBe('police');
    const ex = r.exportObject('test'); expect(ex.header.schemaVersion).toBe(6);
    expect(ex.confirmations).toHaveLength(1); expect(JSON.stringify(ex.confirmations)).not.toContain('40.123456');
    r.setNativeHealth(parseNativeHealth(JSON.stringify({ scanRestarts: { stall: 2, periodic: 5, screen: 1, failed: 0 }, screenOffSec: 300, quiet: false, baselinePerMin: 410, android: { sdk: 28, release: '9', deviceClass: 'android-8.1-11' }, serial: 'X' }))!);
    const h = r.exportObject('test').health as any; expect(h.scanRestarts.stall).toBe(2); expect(h.android.sdk).toBe(28); expect(JSON.stringify(h)).not.toContain('serial');
  });
  it('parseNativeHealth rejects junk', () => { expect(parseNativeHealth('nope')).toBeNull(); });
});
