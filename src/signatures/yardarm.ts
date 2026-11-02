import type { Signature } from './types';
/** Yardarm Technologies holster sensors (tech used by Axon Signal Sidearm). Source: SIG company ID 0x025F. */
export const YARDARM: Signature[] = [
  { id: 'yardarm-cid', label: 'Yardarm holster sensor (company ID)', vendor: 'Yardarm', category: 'other', rule: { kind: 'companyId', id: 0x025f }, baseConfidence: 0.6, status: 'unverified', source: 'Bluetooth SIG company identifiers', note: 'Niche law-enforcement vendor; low FP risk.' },
];
