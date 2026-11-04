import { describe, it, expect } from 'vitest';
import { match, hits } from '../ble/matcher';
import { normalizeEvent } from '../ble/normalize';
import { toEvent, nativeFilters } from '../ble/nativeScanner';
import { SIGNATURES, VENDORS, validateRegistry, axonSerialShape, tierOf, byId, OUIS } from '.';
import { matchWifi, nativeWifiRules } from '../wifi/rules';
import { SessionRecorder } from '../recorder/recorder';
import type { Advertisement } from '../ble/types';

const dv = (b: number[]) => new DataView(new Uint8Array(b).buffer);
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
const u = (x: number) => `0000${x.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
const adv = (p: Partial<Advertisement>): Advertisement => ({ sessionId: 's', timestamp: 0, rssi: -70, manufacturerData: new Map(), serviceUuids: [], serviceData: new Map(), ...p });
const SERIAL = [0x02, ...ascii('X870054FW')];
const ids = (a: Advertisement) => hits(a).map(h => h.signature.id);

describe('registry', () => {
  it('is valid, unique, and every vendor module contributes', () => {
    expect(() => validateRegistry()).not.toThrow();
    for (const [v, list] of Object.entries(VENDORS)) expect(list.length, v).toBeGreaterThan(0);
    expect(SIGNATURES.length).toBe(Object.values(VENDORS).flat().length);
  });
  it('rejects duplicates and new signatures without a source', () => {
    const s = SIGNATURES[0];
    expect(() => validateRegistry([s, s])).toThrow(/duplicate/);
    expect(() => validateRegistry([{ ...s, id: 'x', addedIn: '1.0.18', source: undefined }])).toThrow(/source/);
  });
  it('1.0.18 additions are marked and cited', () => {
    const added = SIGNATURES.filter(s => s.addedIn === '1.0.18').map(s => s.id).sort();
    expect(added).toEqual(['axon-cid-any', 'axon-fe6b-svcdata', 'axon-metropolis-tag', 'axon-oui-ble']);
    for (const s of SIGNATURES.filter(s => s.addedIn || s.changedIn)) expect(s.source, s.id).toBeTruthy();
  });
  it('existing status tiers are kept; grades derive from confidence', () => {
    expect(new Set(SIGNATURES.map(s => s.status))).toEqual(new Set(['unverified']));
    expect(tierOf(byId('bwc-tag')!)).toBe('strong'); expect(tierOf(byId('axon-cid')!)).toBe('likely'); expect(tierOf(byId('moto-cid')!)).toBe('hint');
  });
  it('native filters are derived from the registry (incl. OUIs and service-data UUIDs)', () => {
    const f = nativeFilters();
    expect(f.companyIds).toEqual(expect.arrayContaining([0x034d, 0x025f, 0x04ec, 0x09c8]));
    expect(f.serviceUuids).toEqual(expect.arrayContaining(['fc81', 'fe6b', 'fe6c']));
    expect(f.ouis).toEqual(['00:25:DF']); expect(OUIS).toEqual(['00:25:DF']);
  });
});

describe('BWCDEVICE tag (0.90, MAC-independent)', () => {
  it('matches in service data, either byte order, at 0.90', () => {
    expect(match(adv({ serviceData: new Map([['0000feaa-0000-1000-8000-00805f9b34fb', dv(ascii('AXJANUSBWCDEVICE'))]]) }))).toMatchObject({ confidence: 0.9 });
    const rev = ascii('AXJANUSBWCDEVICE').reverse();
    const m = match(adv({ serviceData: new Map([[u(0x1234), dv(rev)]]) }));
    expect(m?.signature.id).toBe('bwc-tag'); expect(m?.hits?.[0].reason).toMatch(/reversed/);
  });
  it('matches in manufacturer data too', () => expect(match(adv({ manufacturerData: new Map([[0xffff, dv(ascii('xxBWCDEVICE'))]]) }))?.signature.id).toBe('bwc-tag'));
  it('negatives: spaced display string, partial tag, tag in the name only', () => {
    expect(ids(adv({ serviceData: new Map([[u(0x1234), dv(ascii('BWC DEVICE'))]]) }))).not.toContain('bwc-tag');
    expect(ids(adv({ serviceData: new Map([[u(0x1234), dv(ascii('BWCDEVIC'))]]) }))).not.toContain('bwc-tag');
    expect(ids(adv({ name: 'BWCDEVICE-speaker' }))).not.toContain('bwc-tag');
  });
});

describe('METROPOLISDEVICE tag', () => {
  it('matches forward and reversed', () => {
    expect(match(adv({ serviceData: new Map([[u(0x1234), dv(ascii('METROPOLISDEVICE'))]]) }))?.signature.id).toBe('axon-metropolis-tag');
    expect(ids(adv({ serviceData: new Map([[u(0x1234), dv(ascii('METROPOLISDEVICE').reverse())]]) }))).toContain('axon-metropolis-tag');
  });
  it('negative: METROPOLIS alone', () => expect(match(adv({ serviceData: new Map([[u(0x1234), dv(ascii('METROPOLIS'))]]) }))).toBeNull());
});

describe('Axon 0x034D serial shape (in memory only)', () => {
  it('accepts 0x02 + 9 uppercase alphanumerics', () => {
    expect(axonSerialShape(dv(SERIAL))).toBe(true);
    const m = match(adv({ manufacturerData: new Map([[0x034d, dv(SERIAL)]]) }));
    expect(m?.signature.id).toBe('axon-cid'); expect(m?.confidence).toBe(0.75);
    expect(m?.hits?.[0].reason).toBe('company ID 0x034D + serial shape');
    expect(JSON.stringify(m?.hits)).not.toContain('X870054FW');
  });
  const bad: [string, number[]][] = [
    ['empty', []], ['one byte', [1]], ['wrong first byte', [0x03, ...ascii('X870054FW')]], ['8 chars', [0x02, ...ascii('X870054F')]],
    ['10 chars', [0x02, ...ascii('X870054FWA')]], ['lowercase', [0x02, ...ascii('x870054fw')]], ['punctuation', [0x02, ...ascii('X870054F-')]],
    ['starts with own address bytes', [0xd8, 0x1f, 0x65, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]],
  ];
  for (const [n, b] of bad) it(`rejects ${n} (falls back to hint-grade axon-cid-any)`, () => {
    expect(axonSerialShape(dv(b))).toBe(false);
    const m = match(adv({ manufacturerData: new Map([[0x034d, dv(b)]]) }));
    expect(m?.signature.id).toBe('axon-cid-any'); expect(m?.confidence).toBe(0.45); expect(tierOf(m!.signature)).toBe('hint');
  });
  it('serial-shaped CID does not stack with the bare-CID fallback', () => { const m = match(adv({ manufacturerData: new Map([[0x034d, dv(SERIAL)]]) })); expect(m?.confidence).toBe(0.75); expect(m?.corroborated).toBe(false); });
});

describe('Axon / TASER service UUIDs (SIG-verified owners)', () => {
  it('FC81 in UUID list or service data', () => {
    expect(match(adv({ serviceUuids: [u(0xfc81)] }))?.signature.id).toBe('axon-fc81');
    expect(match(adv({ serviceData: new Map([[u(0xfc81), dv([1])]]) }))?.signature.id).toBe('axon-fc81');
  });
  it('FE6C', () => expect(match(adv({ serviceUuids: [u(0xfe6c)] }))?.signature.id).toBe('taser-fe6c'));
  it('FE6B service data with payload -> 0.75 body cam; in UUID list only -> 0.6', () => {
    const m = match(adv({ serviceData: new Map([[u(0xfe6b), dv(ascii('D01AT522D'))]]) }));
    expect(m?.signature.id).toBe('axon-fe6b-svcdata'); expect(m?.confidence).toBe(0.75); expect(m?.corroborated).toBe(false);
    expect(match(adv({ serviceUuids: [u(0xfe6b)] }))).toMatchObject({ confidence: 0.6 });
    expect(ids(adv({ serviceUuids: [u(0xfe6b)] }))).not.toContain('axon-fe6b-svcdata');
  });
  it('FE6B service data with an empty payload is not the svc-data rule', () => expect(ids(adv({ serviceData: new Map([[u(0xfe6b), dv([])]]) }))).toEqual(['taser-fe6b']));
  it('negatives: neighbouring UUIDs FE6A / FE6D / FC80 / FC82', () => {
    for (const x of [0xfe6a, 0xfe6d, 0xfc80, 0xfc82]) expect(match(adv({ serviceUuids: [u(x)], serviceData: new Map([[u(x), dv([1, 2])]]) }))).toBeNull();
  });
  it('independent Axon evidence corroborates (tag + serial CID)', () => {
    const m = match(adv({ manufacturerData: new Map([[0x034d, dv(SERIAL)]]), serviceData: new Map([[u(0x1234), dv(ascii('BWCDEVICE'))]]) }));
    expect(m?.signature.id).toBe('bwc-tag'); expect(m?.corroborated).toBe(true); expect(m!.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('Axon OUI 00:25:DF on BLE (public address, low weight)', () => {
  it('matches only via the native oui flag, at 0.5', () => {
    const m = match(adv({ oui: '00:25:DF' })); expect(m?.signature.id).toBe('axon-oui-ble'); expect(m?.confidence).toBe(0.5);
  });
  it('negatives: other OUI, no flag', () => { expect(match(adv({ oui: 'D8:1F:65' }))).toBeNull(); expect(match(adv({}))).toBeNull(); });
  it('native bridge passes only a well-formed prefix, never a full address', async () => {
    const a = await normalizeEvent(toEvent({ id: 'hash', oui: '00:25:df' }));
    expect(a.oui).toBe('00:25:DF');
    const b = await normalizeEvent(toEvent({ id: 'hash', oui: '00:25:DF:12:34:56' } as any));
    expect(b.oui).toBeUndefined();
  });
  it('OUI + tag corroborate', () => expect(match(adv({ oui: '00:25:DF', serviceData: new Map([[u(1), dv(ascii('BWCDEVICE'))]]) }))?.corroborated).toBe(true));
});

describe('Axon OUI on Android Wi-Fi BSSIDs (in memory only)', () => {
  it('matches the BSSID prefix', () => { const m = matchWifi('', '00:25:df:aa:bb:cc'); expect(m?.best.id).toBe('axon-oui-wifi'); expect(m?.confidence).toBe(0.6); expect(JSON.stringify(m)).not.toMatch(/aa:bb:cc/i); });
  it('negatives: other vendor, SSID containing the OUI text, missing BSSID', () => {
    expect(matchWifi('home', '00:25:DE:00:00:01')).toBeNull();
    expect(matchWifi('00:25:DF', 'AA:BB:CC:00:00:01')).toBeNull();
    expect(matchWifi('x', undefined)).toBeNull();
  });
  it('is shipped to the native watcher', () => expect(nativeWifiRules().find(r => r.id === 'axon-oui-wifi')?.ouis).toEqual(['00:25:DF']));
});

describe('consumer false-positive guards', () => {
  const cases: [string, Partial<Advertisement>][] = [
    ['iPhone', { manufacturerData: new Map([[0x004c, dv([0x10, 0x05, 0x01, 0x18, 0x44])]]) }],
    ['Galaxy Buds', { name: 'Galaxy Buds2', manufacturerData: new Map([[0x0075, dv([0x42, 0x09, 0x81])]]) }],
    ['Fast Pair FE2C', { serviceData: new Map([[u(0xfe2c), dv([0, 1, 2])]]) }],
    ['Eddystone URL mentioning bwc', { serviceData: new Map([[u(0xfeaa), dv(ascii('bwcdevice.example'))]]) }],
    ['Tile FEED', { serviceUuids: [u(0xfeed)] }],
  ];
  for (const [n, p] of cases) it(n, () => expect(match(adv(p))).toBeNull());
});

describe('field-test label + export schema v3', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
  it('label can be set during and edited after the session; export carries label + hits by id/tier, no serial', () => {
    const r = new SessionRecorder(mem()); r.start('t');
    r.setLabel('unsure');
    const a = adv({ sessionId: 'h1', manufacturerData: new Map([[0x034d, dv(SERIAL)]]), serviceData: new Map([[u(1), dv(ascii('BWCDEVICE'))]]) });
    r.add(a, match(a), { lat: 40.1164, lng: -88.2433 }); r.stop();
    r.setLabel('police-present');
    const o = r.exportObject('1.0.18');
    expect(o.header.schemaVersion).toBe(5);
    expect(o.header.fieldLabel).toMatchObject({ value: 'police-present', setDuringSession: true });
    expect(o.signatureHits.map(h => [h.id, h.tier])).toEqual(expect.arrayContaining([['bwc-tag', 'strong'], ['axon-cid', 'likely']]));
    const json = JSON.stringify(o);
    expect(json).not.toContain('X870054FW'); expect(json).not.toContain('583837303035344657'); expect(json).not.toContain('40.1164,');
    expect(() => r.setLabel('maybe' as any)).toThrow(); r.setLabel(null); expect(r.exportObject('x').header.fieldLabel).toBeNull();
  });
});
