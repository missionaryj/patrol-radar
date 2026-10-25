import { describe, it, expect } from 'vitest';
import { buildPoliceFilters, withoutManufacturerFilters } from './filters';
import { SIGNATURES } from './signatures';

describe('buildPoliceFilters', () => {
  const o = buildPoliceFilters();
  it('includes Axon + Motorola company IDs and known UUIDs', () => {
    expect(o.filters).toContainEqual({ manufacturerData: [{ companyIdentifier: 0x034d }] });
    expect(o.filters).toContainEqual({ manufacturerData: [{ companyIdentifier: 0x04ec }] });
    expect(o.filters).toContainEqual({ services: [0xfc81] });
    expect(o.optionalManufacturerData).toEqual(expect.arrayContaining([0x034d, 0x04ec]));
  });
  it('includes name prefixes incl. derived BodyWorn', () => {
    const names = o.filters.map(f => f.namePrefix).filter(Boolean);
    expect(names).toEqual(expect.arrayContaining(['BWC', 'Axon', 'BodyWorn']));
  });
  it('emits no empty/invalid fields', () => {
    for (const f of o.filters) {
      expect(Object.keys(f)).toHaveLength(1);
      if (f.namePrefix !== undefined) expect(f.namePrefix.length).toBeGreaterThan(0);
      if (f.services) expect(f.services.length).toBe(1);
    }
    const bad = buildPoliceFilters([{ ...SIGNATURES[0], rule: { kind: 'companyId', id: -1 } }, { ...SIGNATURES[0], rule: { kind: 'serviceUuid16', uuid: 0x1ffff } }], ['', ' ']);
    expect(bad.filters).toEqual([]);
  });
  it('stays in sync with signatures', () => {
    const n = buildPoliceFilters([...SIGNATURES, { ...SIGNATURES[0], id: 'x', rule: { kind: 'companyId', id: 0x1234 } }]);
    expect(n.filters).toContainEqual({ manufacturerData: [{ companyIdentifier: 0x1234 }] });
  });
  it('fallback drops manufacturer filters', () => { expect(withoutManufacturerFilters(o).filters.some(f => f.manufacturerData)).toBe(false); });
});
