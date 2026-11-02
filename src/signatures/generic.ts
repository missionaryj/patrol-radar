import type { Signature } from './types';
/** Multi-vendor / name heuristics. */
export const GENERIC: Signature[] = [
  { id: 'bwc-name', label: 'Body cam (BWC name)', vendor: 'multiple', category: 'body-camera', rule: { kind: 'namePattern', pattern: /^BWC/i }, baseConfidence: 0.5, status: 'unverified' },
];
