import type { Advertisement } from '../ble/types';

/**
 * Common signature interface. Every vendor module exports a `Signature[]`; the registry (index.ts) collects them.
 * Matching is passive and in memory: a rule sees one advertisement, returns whether it matched (and why), and
 * keeps nothing. Payload bytes used for a shape check (e.g. an Axon serial) are never stored or exported.
 */
export type Rule =
  | { kind: 'companyId'; id: number; payload?: (dv: DataView) => boolean; payloadNote?: string } // optional in-memory payload shape gate
  | { kind: 'serviceUuid16'; uuid: number }                       // UUID list OR service data
  | { kind: 'serviceData16'; uuid: number; minLen?: number }      // service data only (AD 0x16), with a payload
  | { kind: 'namePattern'; pattern: RegExp }
  | { kind: 'payloadAscii'; text: string }                        // ASCII tag anywhere in mfr/service data, either byte order
  | { kind: 'addressOui'; oui: string };                          // "AA:BB:CC", checked natively on PUBLIC addresses only

/** Existing tiers are the `status` values. `tierOf()` adds a display grade derived from baseConfidence. */
export type Status = 'unverified' | 'field-validated';
export type Grade = 'strong' | 'likely' | 'hint';

export interface Signature {
  id: string;
  label: string;
  vendor: string;
  category: 'body-camera' | 'cew' | 'radio' | 'vehicle' | 'printer' | 'fixed' | 'other'; // 'fixed' = stationary infrastructure
  rule: Rule;
  baseConfidence: number; // 0..1
  status: Status;
  note?: string;
  /** App version that introduced the signature (new in this release: "1.0.18"). */
  addedIn?: string;
  /** App version that last changed its rule or weight. */
  changedIn?: string;
  /** Public source(s) for the signature. */
  source?: string;
  /** Signatures in the same group describe the same evidence: they never corroborate each other. */
  group?: string;
}

export interface RuleHit { signature: Signature; reason: string }
export type { Advertisement };

export function tierOf(s: Signature): Grade { return s.baseConfidence >= 0.85 ? 'strong' : s.baseConfidence >= 0.5 ? 'likely' : 'hint'; }

const uuid16 = (u: number) => `0000${u.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
const hex4 = (n: number) => '0x' + n.toString(16).toUpperCase().padStart(4, '0');
function ascii(dv: DataView): string { let s = ''; for (let i = 0; i < dv.byteLength; i++) s += String.fromCharCode(dv.getUint8(i)); return s; }

/** Evaluates one rule against one advert. Returns a human-readable reason (never containing payload bytes) or null. */
export function matchRule(sig: Signature, adv: Advertisement): string | null {
  const r = sig.rule;
  switch (r.kind) {
    case 'companyId': {
      const dv = adv.manufacturerData.get(r.id); if (!dv) return null;
      if (r.payload && !r.payload(dv)) return null;
      return `company ID ${hex4(r.id)}${r.payload ? ` + ${r.payloadNote ?? 'payload shape'}` : ''}`;
    }
    case 'serviceUuid16': {
      const u = uuid16(r.uuid);
      if (adv.serviceData.has(u)) return `service data ${hex4(r.uuid)}`;
      return adv.serviceUuids.includes(u) ? `service UUID ${hex4(r.uuid)}` : null;
    }
    case 'serviceData16': { const dv = adv.serviceData.get(uuid16(r.uuid)); return dv && dv.byteLength >= (r.minLen ?? 1) ? `service data ${hex4(r.uuid)} with payload` : null; }
    case 'namePattern': return adv.name && r.pattern.test(adv.name) ? 'device name' : null;
    case 'payloadAscii': {
      const rev = r.text.split('').reverse().join('');
      for (const b of [...adv.manufacturerData.values(), ...adv.serviceData.values()].map(ascii)) {
        if (b.includes(r.text)) return `payload tag ${r.text}`;
        if (b.includes(rev)) return `payload tag ${r.text} (reversed)`;
      }
      return null;
    }
    case 'addressOui': return adv.oui && adv.oui.toUpperCase() === r.oui.toUpperCase() ? `public address OUI ${r.oui}` : null;
  }
}
