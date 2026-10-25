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
  category: 'body-camera' | 'cew' | 'radio' | 'vehicle' | 'printer' | 'other';
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
  { id: 'moto-cid', label: 'Motorola Solutions (company ID)', vendor: 'Motorola Solutions', category: 'radio', rule: { kind: 'companyId', id: 0x04ec }, baseConfidence: 0.35, status: 'unverified', note: 'Also used by non-police products; low confidence.' },
];

/** Company IDs used to build Web Bluetooth manufacturerData filters. */
export const COMPANY_IDS = [...new Set(SIGNATURES.flatMap(s => s.rule.kind === 'companyId' ? [s.rule.id] : []))];
