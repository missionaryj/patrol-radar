import { describe, it, expect } from 'vitest';
import { VehicleGrouper, rssiCorrelation, combine, MAX_VEHICLE_CONF, type VehicleDetection } from './vehicles';
import { ScanFusion, cellKey, wifiAsMatch } from '../session/extras';
import { SessionRecorder, parseExport } from '../recorder/recorder';
import { scoreWifi } from '../wifi/tiers';
import type { Match } from '../ble/matcher';
import { byId } from '../signatures';

const det = (o: Partial<VehicleDetection>): VehicleDetection => ({ key: 'k', radio: 'ble', ruleId: 'axon-cid', vendor: 'Axon', gear: 'body-camera', confidence: 0.75, rssi: -60, t: 0, cell: 'c1', ...o });

describe('vehicle grouping', () => {
  it('Pearson RSSI correlation over 5 s buckets', () => {
    const a = [0, 5, 10, 15].map((t, i) => ({ t: t * 1000, rssi: -80 + i * 5 }));
    const b = a.map(x => ({ t: x.t + 500, rssi: x.rssi - 10 }));
    const c = a.map((x, i) => ({ t: x.t, rssi: -60 - i * 5 }));
    expect(rssiCorrelation(a, b)).toBeCloseTo(1); expect(rssiCorrelation(a, c)).toBeCloseTo(-1); expect(rssiCorrelation(a.slice(0, 2), b)).toBeNull();
  });
  it('groups BLE + Wi-Fi in the same cell and window into one vehicle with a capped boost', () => {
    const g = new VehicleGrouper();
    expect(g.add(det({ key: 'ble1', t: 0 }))).toBeUndefined();
    const v = g.add(det({ key: 'wifi1', radio: 'wifi', ruleId: 'cradlepoint-ble-police', vendor: 'Cradlepoint', gear: 'vehicle-router', confidence: 0.6, rssi: -75, t: 5000 }))!;
    expect(v.members.map(m => m.key).sort()).toEqual(['ble1', 'wifi1']); expect(v.radios.sort()).toEqual(['ble', 'wifi']);
    expect(v.baseConfidence).toBe(0.75); expect(v.confidence).toBe(0.9); expect(v.boost).toBe(0.15); // no RSSI correlation yet: +0.15 cap
    expect(g.list(6000)).toHaveLength(1);
  });
  it('does not group across cells, outside the window, or duplicate evidence', () => {
    const g = new VehicleGrouper(); g.add(det({ key: 'a', t: 0 }));
    expect(g.add(det({ key: 'b', radio: 'wifi', gear: 'vehicle-router', vendor: 'Cradlepoint', cell: 'c2', t: 1000 }))).toBeUndefined();
    expect(g.add(det({ key: 'c', radio: 'wifi', gear: 'vehicle-router', vendor: 'Cradlepoint', t: 31_000 + 1 }))).toBeUndefined();
    const g2 = new VehicleGrouper(); g2.add(det({ key: 'a', t: 0 }));
    expect(g2.add(det({ key: 'a2', t: 1000 }))).toBeUndefined(); // same radio, gear and vendor = same evidence
  });
  it('rejects anti-correlated RSSI and adds members to an existing vehicle', () => {
    const g = new VehicleGrouper();
    for (let i = 0; i < 4; i++) g.add(det({ key: 'up', t: i * 5000, rssi: -90 + i * 10 }));
    for (let i = 0; i < 3; i++) g.add(det({ key: 'down', radio: 'wifi', gear: 'vehicle-router', vendor: 'Cradlepoint', confidence: 0.3, t: i * 5000 + 100, rssi: -40 - i * 10 }));
    expect(g.vehicleOf('up')).toBeUndefined();
    const g2 = new VehicleGrouper();
    for (let i = 0; i < 4; i++) { g2.add(det({ key: 'up', t: i * 5000, rssi: -90 + i * 10 })); g2.add(det({ key: 'w', radio: 'wifi', gear: 'vehicle-router', vendor: 'Cradlepoint', confidence: 0.4, t: i * 5000 + 100, rssi: -95 + i * 10 })); }
    const v = g2.vehicleOf('up')!; expect(v.rssiCorrelated).toBe(true);
    g2.add(det({ key: 'radio', gear: 'radio', vendor: 'Motorola Solutions', confidence: 0.4, t: 16_000, rssi: -70 }));
    expect(g2.vehicleOf('radio')?.id).toBe(v.id); expect(v.members).toHaveLength(3);
  });
  it('combined confidence never exceeds the cap', () => {
    const ms = ['ble|a', 'wifi|b', 'ble|c'].map((k, i) => ({ key: k, radio: k.split('|')[0] as 'ble', ruleId: 'x', vendor: `v${i}`, gear: `g${i}`, confidence: 0.9, lastSeen: 0, samples: [] }));
    expect(combine(ms, true).confidence).toBe(MAX_VEHICLE_CONF);
    expect(combine(ms.slice(0, 1), true).confidence).toBe(0.9);
  });
  it('members expire and the vehicle dissolves', () => {
    const g = new VehicleGrouper(); g.add(det({ key: 'a', t: 0 })); g.add(det({ key: 'b', radio: 'wifi', gear: 'vehicle-router', vendor: 'Cradlepoint', confidence: 0.3, t: 1000 }));
    expect(g.list(1000)).toHaveLength(1); expect(g.list(200_000)).toHaveLength(0);
  });
});

describe('ScanFusion end to end (BLE then Wi-Fi in one cell)', () => {
  it('BLE police match lifts Cradlepoint to likely and forms a vehicle; recorder exports v4 vehicles without identifiers', () => {
    const f = new ScanFusion(); const loc = { lat: 40.1101, lng: -88.2401 }; const rec = new SessionRecorder(); rec.start('native');
    const ble: Match = { signature: byId('axon-cid')!, confidence: 0.75, rssi: -62, timestamp: 1000, sessionId: 'blehash', radio: 'ble' };
    expect(f.vehicle(ble, loc)).toBeUndefined();
    const nm = { id: 'wifihash', rssi: -70, rules: ['cradlepoint-oui'], radio: 'radiohash', freq: 5180 };
    const w = f.scoreWifi(nm, loc, 3000)!; expect(w.tierRule).toBe('cradlepoint-ble-police');
    const v = f.vehicle(wifiAsMatch(w, nm, 3000), loc)!; expect(v.members).toHaveLength(2); expect(v.cell).toBe(cellKey(loc));
    expect(rec.vehicle(v)).toBe(true);
    const o = rec.exportObject('t'); expect(o.vehicles).toHaveLength(1); expect(o.vehicles[0].members.map(m => m.radio).sort()).toEqual(['ble', 'wifi']);
    expect(JSON.stringify(o.vehicles)).not.toContain('40.1101');
    const back = parseExport(JSON.stringify(o)); expect(back.schemaVersion).toBe(5); expect(back.vehicles).toHaveLength(1);
    f.clear(); expect(f.vehicles.list(3000)).toHaveLength(0);
  });
  it('fixed cameras (Flock) never join a vehicle', () => {
    const f = new ScanFusion(); const loc = { lat: 40, lng: -88 };
    f.vehicle({ signature: byId('axon-cid')!, confidence: 0.75, rssi: -60, timestamp: 0, sessionId: 'a', radio: 'ble' }, loc);
    const nm = { id: 'fl', rssi: -60, rules: ['flock-ssid'] };
    expect(f.vehicle(wifiAsMatch(scoreWifi(['flock-ssid'])!, nm, 1000), loc)).toBeUndefined();
  });
  it('v3 files still import (no vehicles field)', () => {
    const v3 = { header: { app: 'patrol-radar', schemaVersion: 3 }, records: [] };
    const back = parseExport(JSON.stringify(v3)); expect(back.schemaVersion).toBe(3); expect(back.vehicles).toEqual([]);
  });
});
