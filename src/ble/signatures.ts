/**
 * Data-driven signature list. ALL entries are "unverified, needs field validation"
 * unless noted. Sources: Bluetooth SIG assigned numbers and public prior art
 * (RF Sentinel SIGNATURES.md). Edit here; matcher is generic.
 */
export type Rule =
  | { kind: 'companyId'; id: number }
  | { kind: 'serviceUuid16'; uuid: number }
  | { kind: 'namePattern'; pattern: RegExp }
  | { kind: 'payloadAscii'; text: string }; // ASCII tag anywhere in mfr/service data

export interface Signature {
  id: string;
  label: string;
  vendor: string;
  category: 'body-camera' | 'cew' | 'radio' | 'vehicle' | 'printer' | 'fixed' | 'other'; // 'fixed' = stationary infrastructure (e.g. Flock ALPR), not a patrol unit
  rule: Rule;
  baseConfidence: number; // 0..1
  status: 'unverified' | 'field-validated';
  note?: string;
}

export const SIGNATURES: Signature[] = [
  { id: 'axon-cid', label: 'Axon / TASER (company ID)', vendor: 'Axon', category: 'body-camera', rule: { kind: 'companyId', id: 0x034d }, baseConfidence: 0.6, status: 'unverified', note: 'Bluetooth SIG company ID 0x034D (TASER International). Needs field validation.' },
  { id: 'axon-fc81', label: 'Axon service UUID 0xFC81', vendor: 'Axon', category: 'body-camera', rule: { kind: 'serviceUuid16', uuid: 0xfc81 }, baseConfidence: 0.6, status: 'unverified' },
  { id: 'taser-fe6b', label: 'TASER service UUID 0xFE6B', vendor: 'Axon', category: 'cew', rule: { kind: 'serviceUuid16', uuid: 0xfe6b }, baseConfidence: 0.6, status: 'unverified' },
  { id: 'taser-fe6c', label: 'TASER service UUID 0xFE6C', vendor: 'Axon', category: 'cew', rule: { kind: 'serviceUuid16', uuid: 0xfe6c }, baseConfidence: 0.6, status: 'unverified' },
  { id: 'bwc-tag', label: 'BWCDEVICE payload tag', vendor: 'multiple', category: 'body-camera', rule: { kind: 'payloadAscii', text: 'BWCDEVICE' }, baseConfidence: 0.85, status: 'unverified' },
  { id: 'utility-bodyworn', label: 'Utility BodyWorn remote (name)', vendor: 'Utility Inc.', category: 'body-camera', rule: { kind: 'namePattern', pattern: /BodyWorn Remote/i }, baseConfidence: 0.7, status: 'unverified' },
  { id: 'axon-name', label: 'Axon (device name)', vendor: 'Axon', category: 'body-camera', rule: { kind: 'namePattern', pattern: /^(Axon|TASER)/i }, baseConfidence: 0.5, status: 'unverified', note: 'Name prefix guess; needs field validation.' },
  { id: 'bwc-name', label: 'Body cam (BWC name)', vendor: 'multiple', category: 'body-camera', rule: { kind: 'namePattern', pattern: /^BWC/i }, baseConfidence: 0.5, status: 'unverified' },
  { id: 'moto-cid', label: 'Motorola Solutions (company ID)', vendor: 'Motorola Solutions', category: 'radio', rule: { kind: 'companyId', id: 0x04ec }, baseConfidence: 0.35, status: 'unverified', note: 'Also used by non-police products; low confidence.' },
  // --- Added 2026-10 signature research. Sources (verified 2026-10-26):
  // SIG company IDs: https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/company_identifiers/company_identifiers.yaml
  // SIG member UUIDs: https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/uuids/member_uuids.yaml
  // Yardarm 0x025F: SIG company ID "Yardarm Technologies" (holster/firearm-draw sensors; tech used by Axon Signal Sidearm).
  { id: 'yardarm-cid', label: 'Yardarm holster sensor (company ID)', vendor: 'Yardarm', category: 'other', rule: { kind: 'companyId', id: 0x025f }, baseConfidence: 0.6, status: 'unverified', note: 'SIG CID 0x025F Yardarm Technologies. Niche law-enforcement vendor; low FP risk.' },
  // Motorola Solutions (NOT Motorola Mobility phones, which are 0x0008 / 0xFC7C and deliberately excluded).
  { id: 'moto-fe04', label: 'Motorola Solutions service UUID 0xFE04', vendor: 'Motorola Solutions', category: 'radio', rule: { kind: 'serviceUuid16', uuid: 0xfe04 }, baseConfidence: 0.4, status: 'unverified', note: 'SIG member UUID 0xFE04 Motorola Solutions. Also on business radios/accessories; medium FP risk.' },
  { id: 'moto-fd8e', label: 'Motorola Solutions service UUID 0xFD8E', vendor: 'Motorola Solutions', category: 'radio', rule: { kind: 'serviceUuid16', uuid: 0xfd8e }, baseConfidence: 0.4, status: 'unverified', note: 'SIG member UUID 0xFD8E Motorola Solutions. Medium FP risk.' },
  // Flock Safety ALPR (fixed infrastructure). Source: https://github.com/colonelpanichacks/flock-you (firmware-derived BLE set:
  // "Penguin" battery packs, name Penguin-NNNNNNNNNN / "FS Ext Battery", mfr CID 0x09C8 XUNTONG). Same README notes BLE
  // detection "stopped working some time in the spring" on newer firmware, so expect few hits. XUNTONG is a generic
  // OEM CID -> low weight alone; name + CID corroborate to 0.85.
  { id: 'flock-penguin-name', label: 'Flock ALPR battery (Penguin name)', vendor: 'Flock Safety', category: 'fixed', rule: { kind: 'namePattern', pattern: /^Penguin-\d{10}$/ }, baseConfidence: 0.5, status: 'unverified', note: 'Reported unreliable since spring 2026 (flock-you issue #20); kept as legacy.' },
  { id: 'flock-fsbatt-name', label: 'Flock ALPR battery (FS Ext Battery)', vendor: 'Flock Safety', category: 'fixed', rule: { kind: 'namePattern', pattern: /^FS Ext Battery$/ }, baseConfidence: 0.5, status: 'unverified', note: 'Legacy; unreliable since spring 2026.' },
  // 2026 additions. FS-<hex> name: single public field capture (all-cameras-are-beacons, 2026-06), generic white-label prefix -> hint-grade.
  { id: 'flock-fs-hex-name', label: 'Flock-type battery (FS-<hex> name)', vendor: 'Flock Safety', category: 'fixed', rule: { kind: 'namePattern', pattern: /^FS-[0-9A-F]{4,}$/ }, baseConfidence: 0.4, status: 'unverified', note: 'Single 2026-06 field capture; FS- is a generic white-label prefix.' },
  // Flock Raven (gunshot detector) advertised services, exact named values only (GainSec; flock-you-esp32 2026). Unnamed values in 0x3100-0x3500 are NOT matched (proven FP).
  ...([0x3100, 0x3200, 0x3300, 0x3400, 0x3500] as const).map((u): Signature => ({ id: `flock-raven-${u.toString(16)}`, label: `Flock Raven service 0x${u.toString(16).toUpperCase()}`, vendor: 'Flock Safety', category: 'fixed', rule: { kind: 'serviceUuid16', uuid: u }, baseConfidence: 0.5, status: 'unverified', note: 'Raven acoustic sensor (not ALPR). Unassigned SIG range -> medium FP risk.' })),
  { id: 'flock-xuntong-cid', label: 'Flock-type battery (XUNTONG company ID)', vendor: 'Flock Safety', category: 'fixed', rule: { kind: 'companyId', id: 0x09c8 }, baseConfidence: 0.3, status: 'unverified', note: 'Generic OEM CID; weak alone.' },
];

/** Company IDs used to build Web Bluetooth manufacturerData filters. */
export const COMPANY_IDS = [...new Set(SIGNATURES.flatMap(s => s.rule.kind === 'companyId' ? [s.rule.id] : []))];
