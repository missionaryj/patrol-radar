import type { Signature } from './types';
/**
 * Flock Safety (fixed infrastructure). Sources: github.com/colonelpanichacks/flock-you (Penguin / FS Ext Battery names,
 * XUNTONG CID 0x09C8; README notes BLE detection stopped working spring 2026), all-cameras-are-beacons (FS-<hex>, 2026-06),
 * GainSec / flock-you-esp32 (Raven services, exact named values only; unnamed values in 0x3100-0x3500 are a proven FP).
 */
const FY = 'github.com/colonelpanichacks/flock-you';
export const FLOCK: Signature[] = [
  { id: 'flock-penguin-name', label: 'Flock ALPR battery (Penguin name)', vendor: 'Flock Safety', category: 'fixed', rule: { kind: 'namePattern', pattern: /^Penguin-\d{10}$/ }, baseConfidence: 0.5, status: 'unverified', source: FY, note: 'Reported unreliable since spring 2026 (flock-you issue #20); kept as legacy.' },
  { id: 'flock-fsbatt-name', label: 'Flock ALPR battery (FS Ext Battery)', vendor: 'Flock Safety', category: 'fixed', rule: { kind: 'namePattern', pattern: /^FS Ext Battery$/ }, baseConfidence: 0.5, status: 'unverified', source: FY, note: 'Legacy; unreliable since spring 2026.' },
  { id: 'flock-fs-hex-name', label: 'Flock-type battery (FS-<hex> name)', vendor: 'Flock Safety', category: 'fixed', rule: { kind: 'namePattern', pattern: /^FS-[0-9A-F]{4,}$/ }, baseConfidence: 0.4, status: 'unverified', source: 'github.com/soyboi1312/all-cameras-are-beacons', note: 'Single 2026-06 field capture; FS- is a generic white-label prefix.' },
  ...([0x3100, 0x3200, 0x3300, 0x3400, 0x3500] as const).map((u): Signature => ({ id: `flock-raven-${u.toString(16)}`, label: `Flock Raven service 0x${u.toString(16).toUpperCase()}`, vendor: 'Flock Safety', category: 'fixed', rule: { kind: 'serviceUuid16', uuid: u }, baseConfidence: 0.5, status: 'unverified', source: 'GainSec; flock-you-esp32', note: 'Raven acoustic sensor (not ALPR). Unassigned SIG range -> medium FP risk.' })),
  { id: 'flock-xuntong-cid', label: 'Flock-type battery (XUNTONG company ID)', vendor: 'Flock Safety', category: 'fixed', rule: { kind: 'companyId', id: 0x09c8 }, baseConfidence: 0.3, status: 'unverified', source: FY, note: 'Generic OEM CID; weak alone.' },
];
