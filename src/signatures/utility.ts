import type { Signature } from './types';
/** Utility Inc. BodyWorn. Source: all-cameras-are-beacons docs/signatures.md (nite-oui-collection capture, 2025-08). */
export const UTILITY: Signature[] = [
  { id: 'utility-bodyworn', label: 'Utility BodyWorn remote (name)', vendor: 'Utility Inc.', category: 'body-camera', rule: { kind: 'namePattern', pattern: /BodyWorn Remote/i }, baseConfidence: 0.7, status: 'unverified', source: 'github.com/soyboi1312/all-cameras-are-beacons docs/signatures.md' },
];
