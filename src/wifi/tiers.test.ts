import { describe, it, expect } from 'vitest';
import { WIFI_RULES, matchWifi, nativeWifiRules } from './rules';
import { scoreWifi, WIFI_TIERS, gradeOf } from './tiers';
import { WifiContextTracker, bandOfMHz } from './context';
import { SessionRecorder } from '../recorder/recorder';

describe('tiered Wi-Fi confidence', () => {
  it('OUI-only stays a hint for every generic router vendor', () => {
    for (const id of ['cradlepoint-oui', 'sierra-oui', 'digi-oui', 'inseego-oui']) { const w = scoreWifi([id])!; expect(gradeOf(w.confidence)).toBe('hint'); expect(w.tierRule).toBeUndefined(); }
  });
  it('matches the new IEEE blocks', () => {
    expect(matchWifi('', '00:E0:1C:01:02:03')?.best.id).toBe('cradlepoint-oui');
    expect(matchWifi('', '00-a0-d5-01-02-03')?.best.id).toBe('sierra-oui');
    expect(matchWifi('', '00:16:C0:01:02:03')?.best.id).toBe('sierra-oui');
    expect(matchWifi('', '00:40:9D:01:02:03')?.best.id).toBe('digi-oui');
    expect(matchWifi('', '00:15:FF:01:02:03')?.best.id).toBe('inseego-oui');
    expect(nativeWifiRules().find(r => r.id === 'sierra-oui')!.ouis).toContain('00:A0:D5');
  });
  it('Cradlepoint climbs only with corroboration, and same-vendor rules do not multiply', () => {
    expect(scoreWifi(['cradlepoint-oui', 'cradlepoint-ssid'])!).toMatchObject({ confidence: 0.4, tierRule: 'cradlepoint-oui-ssid' });
    expect(scoreWifi(['cradlepoint-oui'], { dualBand: true })!.tierRule).toBe('cradlepoint-dualband');
    expect(scoreWifi(['cradlepoint-ssid'], { persistent: true })!.confidence).toBe(0.4);
    const ble = scoreWifi(['cradlepoint-oui'], { blePolice: true })!; expect(ble.tierRule).toBe('cradlepoint-ble-police'); expect(gradeOf(ble.confidence)).toBe('likely');
    const top = scoreWifi(['cradlepoint-oui', 'cradlepoint-ssid'], { blePolice: true, persistent: true })!; expect(top).toMatchObject({ confidence: 0.75, tierRule: 'cradlepoint-ble-police-multi' });
    expect(top.features).toEqual(expect.arrayContaining(['oui', 'blePolice', 'persistent', 'ssid']));
    // Nothing reaches strong for Cradlepoint.
    expect(Math.max(...WIFI_TIERS.filter(t => t.vendor === 'Cradlepoint').map(t => t.confidence))).toBeLessThan(0.85);
  });
  it('Axon Wi-Fi: OUI+SSID is likely, Axon BLE nearby is strong', () => {
    expect(scoreWifi(['axon-oui-wifi'])!.confidence).toBe(0.6);
    expect(scoreWifi(['axon-oui-wifi', 'axon-fleet-ssid'])!).toMatchObject({ confidence: 0.8, tierRule: 'axon-wifi-oui-ssid' });
    expect(scoreWifi(['axon-fleet-ssid'], { persistent: true })!.tierRule).toBe('axon-wifi-persistent');
    expect(gradeOf(scoreWifi(['axon-oui-wifi'], { bleAxon: true })!.confidence)).toBe('strong');
    expect(scoreWifi(['axon-oui-wifi'], { blePolice: true })!.confidence).toBe(0.6); // non-Axon BLE does not trigger the Axon tier
  });
  it('other vendors stay at or below their BLE-corroborated tier', () => {
    expect(scoreWifi(['sierra-oui'], { blePolice: true })!.confidence).toBe(0.5);
    expect(gradeOf(scoreWifi(['digi-oui'], { blePolice: true, persistent: true, dualBand: true })!.confidence)).toBe('hint');
    expect(gradeOf(scoreWifi(['inseego-oui'], { blePolice: true })!.confidence)).toBe('hint');
  });
  it('registry sanity: tier ids unique, vendors exist, each tier above the vendor base', () => {
    const ids = [...WIFI_RULES.map(r => r.id), ...WIFI_TIERS.map(t => t.id)]; expect(new Set(ids).size).toBe(ids.length);
    for (const t of WIFI_TIERS) { const base = WIFI_RULES.filter(r => r.vendor === t.vendor); expect(base.length).toBeGreaterThan(0); expect(t.confidence).toBeGreaterThan(Math.max(...base.map(b => b.baseConfidence))); expect(t.confidence).toBeLessThan(1); }
    for (const r of WIFI_RULES.filter(r => r.addedIn === '1.0.19')) expect(r.source).toBeTruthy();
  });
  it('scored output never carries the observed BSSID or SSID', () => {
    const m = matchWifi('IBR900-a1b', '00:30:44:AB:CD:EF')!; const s = JSON.stringify(scoreWifi(m.rules, { blePolice: true }));
    expect(s).not.toMatch(/AB:CD:EF/i); expect(s).not.toContain('IBR900-a1b');
  });
});

describe('Wi-Fi context tracker', () => {
  it('bands from frequency', () => { expect(bandOfMHz(2437)).toBe('2.4'); expect(bandOfMHz(5180)).toBe('5'); expect(bandOfMHz(5955)).toBe('6'); expect(bandOfMHz(undefined)).toBeUndefined(); });
  it('dual-band needs both bands on one radio hash', () => {
    const c = new WifiContextTracker();
    expect(c.observe({ id: 'a', radio: 'r1', band: '2.4', cell: 'x', t: 0 }).dualBand).toBe(false);
    expect(c.observe({ id: 'b', radio: 'r2', band: '5', cell: 'x', t: 1 }).dualBand).toBe(false);
    expect(c.observe({ id: 'c', radio: 'r1', band: '5', cell: 'x', t: 2 }).dualBand).toBe(true);
  });
  it('persistence needs 3 separate scans over 60 s', () => {
    const c = new WifiContextTracker();
    expect(c.observe({ id: 'a', cell: 'x', t: 0 }).persistent).toBe(false);
    expect(c.observe({ id: 'a', cell: 'x', t: 5_000 }).persistent).toBe(false); // same scan window
    expect(c.observe({ id: 'a', cell: 'x', t: 30_000 }).persistent).toBe(false);
    expect(c.observe({ id: 'a', cell: 'x', t: 61_000 }).persistent).toBe(true);
  });
  it('police BLE only counts in the same cell within 30 s', () => {
    const c = new WifiContextTracker(); c.blePolice('x', 0, true);
    expect(c.observe({ id: 'a', cell: 'y', t: 1000 }).blePolice).toBe(false);
    expect(c.observe({ id: 'a', cell: 'x', t: 1000 })).toMatchObject({ blePolice: true, bleAxon: true });
    expect(c.observe({ id: 'b', cell: 'x', t: 40_000 }).blePolice).toBe(false);
    c.clear(); expect(c.observe({ id: 'a', cell: 'x', t: 1 }).blePolice).toBe(false);
  });
});

describe('recorder v4 Wi-Fi fields', () => {
  it('stores radio, tier rule, features and band, never SSID/BSSID', () => {
    const r = new SessionRecorder(); r.start('native');
    r.addWifi(scoreWifi(['cradlepoint-oui'], { blePolice: true })!, -70, { lat: 40.11, lng: -88.24 }, 1000, '5');
    const o = r.exportObject('test'); const rec = o.records[0];
    expect(rec).toMatchObject({ radio: 'wifi', tierRule: 'cradlepoint-ble-police', band: '5', confidence: 0.6 });
    expect(o.signatureHits.find(h => h.id === 'cradlepoint-ble-police')).toMatchObject({ radio: 'wifi', tier: 'likely' });
    expect(JSON.stringify(o)).not.toMatch(/00:30:44|IBR\d/);
  });
});
