import type { Signature } from './types';

/**
 * Axon Enterprise (formerly TASER International). Registry facts re-verified 2026-10-31:
 *  - Bluetooth SIG company ID 0x034D = "TASER International, Inc."
 *    https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/company_identifiers/company_identifiers.yaml
 *  - SIG member UUIDs 0xFE6B, 0xFE6C = "TASER International, Inc."; 0xFC81 = "Axon Enterprise, Inc."
 *    https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/uuids/member_uuids.yaml
 *  - IEEE MA-L 00-25-DF = "Axon Enterprise, Inc."  https://standards-oui.ieee.org/oui/oui.txt
 * Field evidence: all-cameras-are-beacons docs/signatures.md + docs/axon.md (BWCDEVICE tag field-validated
 * 2026-07-19 at conf 90; 0xFE6B service data and serial-shaped 0x034D admitted 2026-10-20/21 at conf 75;
 * METROPOLISDEVICE tag recorded 2026-10-21 on Axon-OUI devices) https://github.com/soyboi1312/all-cameras-are-beacons
 * AXEOFF (colonelpanichacks) uses the same five Axon identifiers: https://github.com/colonelpanichacks/axeoff
 */
const SIG = 'Bluetooth SIG assigned numbers (bitbucket.org/bluetooth-SIG/public)';
const ACAB = 'github.com/soyboi1312/all-cameras-are-beacons docs/signatures.md';
const AXEOFF = 'github.com/colonelpanichacks/axeoff';

/**
 * Axon serial shape behind company ID 0x034D: byte 0x02, then exactly nine uppercase letters or digits (e.g. "X8…").
 * Checked in memory only; the serial is never returned, stored or exported (recorder masking still applies).
 */
export function axonSerialShape(dv: DataView): boolean {
  if (dv.byteLength !== 10 || dv.getUint8(0) !== 0x02) return false;
  for (let i = 1; i < 10; i++) { const c = dv.getUint8(i); if (!((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a))) return false; }
  return true;
}

export const AXON_OUI = '00:25:DF';

export const AXON: Signature[] = [
  { id: 'bwc-tag', label: 'Axon body cam (BWCDEVICE tag)', vendor: 'Axon', category: 'body-camera', rule: { kind: 'payloadAscii', text: 'BWCDEVICE' }, baseConfidence: 0.9, status: 'unverified', changedIn: '1.0.18', source: `${ACAB} (field-validated 2026-07-19, conf 90)`, note: 'MAC-independent. On the wire as reversed "AXJANUSBWCDEVICE"; matched in both byte orders. No space.' },
  { id: 'axon-metropolis-tag', label: 'Axon device (METROPOLISDEVICE tag)', vendor: 'Axon', category: 'body-camera', rule: { kind: 'payloadAscii', text: 'METROPOLISDEVICE' }, baseConfidence: 0.7, status: 'unverified', addedIn: '1.0.18', source: `${ACAB} (recorded 2026-10-21 on 00:25:DF devices; law enforcement confirmed on scene)`, note: 'Second Axon tag, same reversed-byte scheme. Product not yet tied; below BWCDEVICE.' },
  { id: 'axon-cid', label: 'Axon / TASER (company ID + serial shape)', vendor: 'Axon', category: 'body-camera', rule: { kind: 'companyId', id: 0x034d, payload: axonSerialShape, payloadNote: 'serial shape' }, baseConfidence: 0.75, status: 'unverified', changedIn: '1.0.18', group: 'axon-cid', source: `${SIG}; serial gate per ${ACAB} (2026-10-21)`, note: 'Counts only when the payload is 0x02 + 9 uppercase alphanumerics; a bare 0x034D was seen reused on a random address.' },
  // Bare 0x034D (any payload). Our own 2026-10 Champaign capture saw 5 devices on this CID before the serial gate existed, so
  // it stays as a weaker fallback in the same group (never stacks with the serial-shaped rule above).
  { id: 'axon-cid-any', label: 'Axon / TASER company ID (any payload)', vendor: 'Axon', category: 'body-camera', rule: { kind: 'companyId', id: 0x034d }, baseConfidence: 0.45, status: 'unverified', addedIn: '1.0.18', group: 'axon-cid', source: `${SIG}; own capture 2026-10 (Champaign traffic stop, 5 devices)`, note: 'Split from axon-cid in 1.0.18: a bare 0x034D was seen reused on a random address (all-cameras-are-beacons), so it is hint-grade unless the serial shape matches.' },
  { id: 'axon-fe6b-svcdata', label: 'Axon Bluetooth ID (0xFE6B service data)', vendor: 'Axon', category: 'body-camera', rule: { kind: 'serviceData16', uuid: 0xfe6b, minLen: 1 }, baseConfidence: 0.75, status: 'unverified', addedIn: '1.0.18', group: 'axon-fe6b', source: `${SIG}; ${ACAB} (7 devices, owner-confirmed body cam 2026-10-21)`, note: 'Service data with a payload (serial-shaped in every capture). Names the vendor, not the product.' },
  { id: 'taser-fe6b', label: 'TASER service UUID 0xFE6B', vendor: 'Axon', category: 'cew', rule: { kind: 'serviceUuid16', uuid: 0xfe6b }, baseConfidence: 0.6, status: 'unverified', group: 'axon-fe6b', source: `${SIG} (TASER International); ${AXEOFF}`, note: 'SIG-verified owner. Same evidence as axon-fe6b-svcdata, so they never corroborate each other.' },
  { id: 'taser-fe6c', label: 'TASER service UUID 0xFE6C', vendor: 'Axon', category: 'cew', rule: { kind: 'serviceUuid16', uuid: 0xfe6c }, baseConfidence: 0.6, status: 'unverified', source: `${SIG} (TASER International); ${AXEOFF}`, note: 'SIG-verified owner; no public field sighting yet (capture-only in all-cameras-are-beacons).' },
  { id: 'axon-fc81', label: 'Axon service UUID 0xFC81', vendor: 'Axon', category: 'body-camera', rule: { kind: 'serviceUuid16', uuid: 0xfc81 }, baseConfidence: 0.6, status: 'unverified', source: `${SIG} (Axon Enterprise); ${AXEOFF}`, note: 'SIG-verified owner; no public field sighting yet.' },
  { id: 'axon-oui-ble', label: 'Axon public BLE address (OUI 00:25:DF)', vendor: 'Axon', category: 'body-camera', rule: { kind: 'addressOui', oui: AXON_OUI }, baseConfidence: 0.5, status: 'unverified', addedIn: '1.0.18', source: `IEEE MA-L 00-25-DF (Axon Enterprise, Inc.); ${AXEOFF}; ${ACAB} (3 owner-confirmed untagged hits)`, note: 'Android only. Checked natively on public addresses; the address never leaves ScanService. Low weight: any Axon product (dock, fleet gear) matches; rotating MACs hide it.' },
  { id: 'axon-name', label: 'Axon (device name)', vendor: 'Axon', category: 'body-camera', rule: { kind: 'namePattern', pattern: /^(Axon|TASER)/i }, baseConfidence: 0.5, status: 'unverified', note: 'Name prefix guess; needs field validation.' },
];
