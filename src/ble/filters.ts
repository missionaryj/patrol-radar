import { SIGNATURES, type Signature } from './signatures';

export interface RequestFilter { manufacturerData?: { companyIdentifier: number }[]; services?: number[]; namePrefix?: string; }
export interface PoliceRequestOptions { filters: RequestFilter[]; optionalManufacturerData: number[]; optionalServices: number[]; }

/** Extra name prefixes for the picker (name rules are regexes, so prefixes are listed explicitly). */
export const NAME_PREFIXES = ['BWC', 'Axon', 'AXON', 'BodyWorn', 'TASER'];

/** Builds requestDevice filters from signatures.ts so they stay in sync. Only valid, non-empty fields are emitted. */
export function buildPoliceFilters(sigs: Signature[] = SIGNATURES, prefixes = NAME_PREFIXES): PoliceRequestOptions {
  const cids = new Set<number>(), uuids = new Set<number>(), names = new Set<string>();
  for (const s of sigs) {
    const r = s.rule;
    if (r.kind === 'companyId' && Number.isInteger(r.id) && r.id >= 0 && r.id <= 0xffff) cids.add(r.id);
    if (r.kind === 'serviceUuid16' && Number.isInteger(r.uuid) && r.uuid > 0 && r.uuid <= 0xffff) uuids.add(r.uuid);
    if (r.kind === 'namePattern') { const m = r.pattern.source.match(/^[A-Za-z0-9 ]+/); if (m && m[0].trim()) names.add(m[0].trim().split(' ')[0]); }
  }
  for (const p of prefixes) if (p && p.trim()) names.add(p.trim());
  const filters: RequestFilter[] = [
    ...[...cids].map(c => ({ manufacturerData: [{ companyIdentifier: c }] })),
    ...[...uuids].map(u => ({ services: [u] })),
    ...[...names].map(n => ({ namePrefix: n })),
  ];
  return { filters, optionalManufacturerData: [...cids], optionalServices: [...uuids] };
}

/** Same as buildPoliceFilters but without manufacturerData filters (some browsers reject them). */
export function withoutManufacturerFilters(o: PoliceRequestOptions): PoliceRequestOptions {
  return { ...o, filters: o.filters.filter(f => !f.manufacturerData) };
}
