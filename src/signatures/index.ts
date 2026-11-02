/**
 * Signature registry. To add a vendor: create src/signatures/<vendor>.ts exporting a Signature[] and add it to VENDORS.
 * Native hardware filters (company IDs, service UUIDs, OUIs) and the web picker filters are derived from this list.
 * Docs: docs/signatures.md (sources, rejected candidates).
 */
import type { Signature } from './types';
import { AXON } from './axon';
import { GENERIC } from './generic';
import { UTILITY } from './utility';
import { MOTOROLA } from './motorola';
import { YARDARM } from './yardarm';
import { FLOCK } from './flock';

export * from './types';
export { axonSerialShape, AXON_OUI } from './axon';

export const VENDORS: Record<string, Signature[]> = { axon: AXON, generic: GENERIC, utility: UTILITY, motorola: MOTOROLA, yardarm: YARDARM, flock: FLOCK };
export const SIGNATURES: Signature[] = Object.values(VENDORS).flat();

/** Throws on duplicate ids or out-of-range values (run in tests). */
export function validateRegistry(sigs: Signature[] = SIGNATURES): void {
  const seen = new Set<string>();
  for (const s of sigs) {
    if (seen.has(s.id)) throw new Error(`duplicate signature id ${s.id}`); seen.add(s.id);
    if (!(s.baseConfidence > 0 && s.baseConfidence < 1)) throw new Error(`bad confidence on ${s.id}`);
    if (s.addedIn && !s.source) throw new Error(`new signature ${s.id} needs a source`);
  }
}
export const byId = (id: string) => SIGNATURES.find(s => s.id === id);
/** Company IDs used to build Web Bluetooth / native manufacturerData filters. */
export const COMPANY_IDS = [...new Set(SIGNATURES.flatMap(s => s.rule.kind === 'companyId' ? [s.rule.id] : []))];
export const SERVICE_UUIDS16 = [...new Set(SIGNATURES.flatMap(s => s.rule.kind === 'serviceUuid16' || s.rule.kind === 'serviceData16' ? [s.rule.uuid] : []))];
export const OUIS = [...new Set(SIGNATURES.flatMap(s => s.rule.kind === 'addressOui' ? [s.rule.oui.toUpperCase()] : []))];
