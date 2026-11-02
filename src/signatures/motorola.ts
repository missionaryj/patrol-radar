import type { Signature } from './types';
/**
 * Motorola Solutions (NOT Motorola Mobility phones, 0x0008 / 0xFC7C, deliberately excluded).
 * Source: Bluetooth SIG company IDs + member UUIDs (bitbucket.org/bluetooth-SIG/public).
 */
const SIG = 'Bluetooth SIG assigned numbers';
export const MOTOROLA: Signature[] = [
  { id: 'moto-cid', label: 'Motorola Solutions (company ID)', vendor: 'Motorola Solutions', category: 'radio', rule: { kind: 'companyId', id: 0x04ec }, baseConfidence: 0.35, status: 'unverified', source: SIG, note: 'Also used by non-police products; low confidence.' },
  { id: 'moto-fe04', label: 'Motorola Solutions service UUID 0xFE04', vendor: 'Motorola Solutions', category: 'radio', rule: { kind: 'serviceUuid16', uuid: 0xfe04 }, baseConfidence: 0.4, status: 'unverified', source: SIG, note: 'Also on business radios/accessories; medium FP risk.' },
  { id: 'moto-fd8e', label: 'Motorola Solutions service UUID 0xFD8E', vendor: 'Motorola Solutions', category: 'radio', rule: { kind: 'serviceUuid16', uuid: 0xfd8e }, baseConfidence: 0.4, status: 'unverified', source: SIG, note: 'Medium FP risk.' },
];
