import { describe, it, expect } from 'vitest';
import { SessionRecorder } from '../recorder/recorder';
import { scoreWifi } from './tiers';
import { classifyWifiTime, isSessionHash, wifiDev, WIFI_EVIDENCE_LINE, VEHICLE_EVIDENCE_LINE, SIGHTING_NOTE } from './identity';
import { planWifi } from './observe';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const ap = (hex: string) => 'n' + hex.repeat(16).slice(0, 16);
const axon = () => scoreWifi(['axon-oui-wifi'])!;
const PRECISE = { lat: 40.123456789, lng: -88.234567891 };

describe('Wi-Fi access-point identity', () => {
  it('accepts only the native per-session hash shape', () => {
    expect(isSessionHash(ap('a'))).toBe(true);
    expect(isSessionHash('00:25:DF:11:22:33')).toBe(false);
    expect(isSessionHash('axon-oui-wifi')).toBe(false);
    expect(wifiDev('axon-oui-wifi', ap('a'))).toEqual({ dev: ap('a'), identity: 'ap', apId: ap('a') });
    expect(wifiDev('axon-oui-wifi', '00:25:DF:11:22:33')).toEqual({ dev: 'wifi:axon-oui-wifi', identity: 'signature' });
  });

  it('keeps two access points with the same signature distinct, and repeated scans as history', () => {
    const r = new SessionRecorder(mem()); r.start('native');
    const t0 = Date.now();
    r.noteWifi({ match: axon(), rssi: -80, apId: ap('a'), radioId: ap('1'), scanAt: t0, receivedAt: t0, scanStartedAt: t0 - 1000, loc: PRECISE });
    r.noteWifi({ match: axon(), rssi: -80, apId: ap('a'), radioId: ap('1'), scanAt: t0, receivedAt: t0, scanStartedAt: t0 - 1000 });
    r.noteWifi({ match: axon(), rssi: -62, apId: ap('a'), radioId: ap('1'), scanAt: t0 + 30_000, receivedAt: t0 + 30_000, scanStartedAt: t0 - 1000 });
    r.noteWifi({ match: axon(), rssi: -70, apId: ap('b'), radioId: ap('2'), scanAt: t0 + 1000, receivedAt: t0 + 1000, scanStartedAt: t0 - 1000, loc: PRECISE });
    const rows = r.s.records.filter(x => x.radio === 'wifi');
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(x => x.dev))).toEqual(new Set([ap('a'), ap('b')]));
    expect(rows.every(x => x.bestRule === 'axon-oui-wifi' && x.identity === 'ap' && x.rules.includes('axon-oui-wifi'))).toBe(true);
    const a = r.summary().find(d => d.dev === ap('a'))!;
    expect(a.adverts).toBe(2);
    expect(a.minRssi).toBe(-80); expect(a.maxRssi).toBe(-62);
    expect(Date.parse(a.firstSeen)).toBe(t0); expect(Date.parse(a.lastSeen)).toBe(t0 + 30_000);
    expect(a.identity).toBe('ap'); expect(a.retentions).toEqual(['session']);
    expect(rows.find(x => x.dev === ap('a'))!.radioId).toBe(ap('1'));
  });

  it('falls back to one signature bucket when the scan has no distinguishable id', () => {
    const r = new SessionRecorder(mem()); r.start('native');
    const t0 = Date.now();
    const ssid = 'Axon7-5g';
    r.noteWifi({ match: axon(), rssi: -70, apId: '00:25:DF:11:22:33', radioId: 'AA:BB:CC:DD:EE:FF', scanAt: t0, receivedAt: t0, scanStartedAt: t0 - 1 });
    r.noteWifi({ match: axon(), rssi: -65, apId: '00:25:DF:44:55:66', scanAt: t0 + 20_000, receivedAt: t0 + 20_000, scanStartedAt: t0 - 1 });
    expect(r.summary().map(d => d.dev)).toEqual(['wifi:axon-oui-wifi']);
    expect(r.s.records.every(x => x.identity === 'signature' && x.radioId === undefined)).toBe(true);
    const json = JSON.stringify(r.exportObject('1.0.26'));
    expect(json).not.toMatch(/([0-9A-F]{2}:){5}[0-9A-F]{2}/i);
    expect(json).not.toContain(ssid);
    expect(json).not.toContain('00:25:DF');
    expect(json).not.toContain('AA:BB:CC');
  });

  it('does not carry an access point across a scan-session boundary', () => {
    const r = new SessionRecorder(mem());
    const t0 = Date.now();
    r.noteWifi({ match: axon(), apId: ap('a'), scanAt: t0, receivedAt: t0, scanStartedAt: t0 - 1000 });
    r.discardWifiSession();
    r.start('native');
    const t1 = Date.now();
    r.noteWifi({ match: axon(), apId: ap('b'), scanAt: t1, receivedAt: t1, scanStartedAt: t1 - 1000 });
    const devs = r.summary().map(d => d.dev);
    expect(devs).toEqual([ap('b')]);
    expect(devs).not.toContain(ap('a'));
  });

  it('retains the earlier observation when a confirmation happens before the recording row', () => {
    const real = Date.now; let now = 1_700_000_000_000; Date.now = () => now;
    try {
      const r = new SessionRecorder(mem());
      const id = ap('c');
      r.noteWifi({ match: axon(), rssi: -71, apId: id, scanAt: now - 40_000, receivedAt: now, scanStartedAt: now - 60_000 });
      const c = r.confirm({ verdict: 'police', kind: 'device', dev: id, radio: 'wifi', rules: ['axon-oui-wifi'], tier: 'likely', confidence: 0.6, rssi: -71 }, PRECISE);
      expect(c.t).toBe(now);
      expect(r.s.records).toHaveLength(1);
      expect(r.s.records[0].t).toBe(now - 40_000);
      expect(r.s.records[0].t).toBeLessThan(c.t);
      expect(r.s.records[0].retention).toBe('history');
      expect(r.s.records[0].dev).toBe(id);
      const ex = r.exportObject('1.0.26');
      expect(Date.parse(ex.devices[0].firstSeen)).toBe(now - 40_000);
      expect(JSON.stringify(ex)).not.toContain('40.123456789');
      expect(JSON.stringify(ex.records)).not.toMatch(/"name"|"ssid"|"bssid"|"mac"|manufacturerData":\[\{/);
    } finally { Date.now = real; }
  });

  it('labels OS cache and pre-recording rows apart from the current recording', () => {
    const real = Date.now; let now = 1_700_000_100_000; Date.now = () => now;
    try {
      const r = new SessionRecorder(mem());
      r.noteWifi({ match: axon(), apId: ap('d'), scanAt: now - 5_000, receivedAt: now, scanStartedAt: now - 1_000, cached: true });
      now += 2_000;
      r.start('native');
      const started = r.s.startedAt!;
      r.noteWifi({ match: axon(), rssi: -55, apId: ap('d'), scanAt: started + 1_000, receivedAt: started + 1_000, scanStartedAt: started - 500 });
      const rows = r.s.records.filter(x => x.dev === ap('d'));
      expect(rows.map(x => x.retention)).toEqual(['buffered', 'session']);
      const d = r.summary().find(x => x.dev === ap('d'))!;
      expect(Date.parse(d.firstSeen)).toBe(now - 2_000 - 5_000);
      expect(d.sessionFirstSeen).toBe(new Date(started + 1_000).toISOString());
      expect(d.retentions).toEqual(['buffered', 'session']);
      expect(classifyWifiTime({ scanAt: started - 10_000, receivedAt: started, scanStartedAt: started, recording: true, recordingStartedAt: started }).retention).toBe('buffered');
    } finally { Date.now = real; }
  });

  it('flushes pre-recording samples as history when recording starts', () => {
    const real = Date.now; let now = 1_700_000_200_000; Date.now = () => now;
    try {
      const r = new SessionRecorder(mem());
      r.noteWifi({ match: axon(), rssi: -90, apId: ap('e'), scanAt: now, receivedAt: now, scanStartedAt: now - 10_000 });
      expect(r.count).toBe(0);
      now += 8_000;
      r.start('native');
      expect(r.s.records[0]).toMatchObject({ dev: ap('e'), retention: 'history', rssi: -90, t: now - 8_000 });
    } finally { Date.now = real; }
  });

  it('stores sighting marks as times, not as a radio or a vehicle count', () => {
    const r = new SessionRecorder(mem()); r.start('native');
    const id = ap('f');
    const t0 = Date.now();
    r.noteWifi({ match: axon(), apId: id, scanAt: t0, receivedAt: t0, scanStartedAt: t0 - 1 });
    const a = r.markSighting('vehicle-arrived', PRECISE, t0 + 1_000)!;
    const left = r.markSighting('vehicle-left', undefined, t0 + 90_000)!;
    expect(a.t).toBe(t0 + 1_000); expect(left.t).toBe(t0 + 90_000);
    expect(a.cell!.lat).not.toBe(PRECISE.lat);
    const ex = r.exportObject('1.0.26');
    expect(ex.sightings.map(s => s.kind)).toEqual(['vehicle-arrived', 'vehicle-left']);
    expect(Date.parse(ex.sightings[0].t)).toBe(t0 + 1_000);
    expect(Date.parse(ex.sightings[1].t)).toBe(t0 + 90_000);
    expect(ex.sightings[0]).not.toHaveProperty('dev');
    expect(JSON.stringify(ex.sightings)).not.toContain(id);
    expect(JSON.stringify(ex.sightings)).not.toContain(String(PRECISE.lat));
    expect(SIGHTING_NOTE).toMatch(/Not tied to a radio/);
    expect(VEHICLE_EVIDENCE_LINE).toMatch(/Not a verified count/);
    expect(WIFI_EVIDENCE_LINE).toMatch(/Not a car or officer count/);
  });

  it('does not let a missing hash share persistence context or leak into the record', () => {
    const mac = { id: '00:25:DF:AB:CD:EF', rules: ['axon-oui-wifi'], rssi: -60, radio: '00:25:DF:AB:CD:EE', t: 10, freq: 2412 };
    const a = planWifi(mac)!; const b = planWifi({ ...mac, id: '00:25:DF:00:11:22' })!;
    expect(a.apId).toBeUndefined();
    expect(a.match.id).toBe('wifi:axon-oui-wifi');
    expect(a.context.id).toMatch(/^anon:/);
    expect(a.context.id).not.toBe(b.context.id);
    expect(a.radioId).toBeUndefined();
    const hashed = planWifi({ ...mac, id: ap('9'), radio: ap('8') })!;
    expect(hashed.apId).toBe(ap('9'));
    expect(hashed.context.id).toBe(ap('9'));
    expect(hashed.radioId).toBe(ap('8'));
    expect(JSON.stringify(hashed)).not.toContain('00:25:DF');
  });
});
