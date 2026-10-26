import type { Advertisement } from './types';
import { SIGNATURES, type Signature } from './signatures';

export interface Match { signature: Signature; corroborated: boolean; confidence: number; rssi?: number; timestamp: number; sessionId: string; }

const uuid16 = (u: number) => `0000${u.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
function ascii(dv: DataView): string { let s = ''; for (let i = 0; i < dv.byteLength; i++) s += String.fromCharCode(dv.getUint8(i)); return s; }

function hit(sig: Signature, adv: Advertisement): boolean {
  const r = sig.rule;
  switch (r.kind) {
    case 'companyId': return adv.manufacturerData.has(r.id);
    case 'serviceUuid16': { const u = uuid16(r.uuid); return adv.serviceUuids.includes(u) || adv.serviceData.has(u); }
    case 'namePattern': return !!adv.name && r.pattern.test(adv.name);
    case 'payloadAscii': {
      const blobs = [...adv.manufacturerData.values(), ...adv.serviceData.values()].map(ascii);
      const rev = r.text.split('').reverse().join('');
      return blobs.some(b => b.includes(r.text) || b.includes(rev));
    }
  }
}

/** Returns the best match, fusing independent hits (1 - Π(1-c)). Weak signals nudged by RSSI. */
export function match(adv: Advertisement): Match | null {
  const hits = SIGNATURES.filter(s => hit(s, adv));
  if (!hits.length) return null;
  let conf = 1 - hits.reduce((p, s) => p * (1 - s.baseConfidence), 1);
  // Corroboration: hits from different rule kinds (e.g. company ID + service UUID) are much stronger evidence.
  const kinds = new Set(hits.map(h => h.rule.kind));
  if (kinds.size >= 2) conf = Math.max(conf, 0.85);
  if (adv.rssi !== undefined && adv.rssi < -90) conf *= 0.85;
  const best = hits.reduce((a, b) => (b.baseConfidence > a.baseConfidence ? b : a));
  return { signature: best, corroborated: kinds.size >= 2, confidence: Math.min(0.99, +conf.toFixed(2)), rssi: adv.rssi, timestamp: adv.timestamp, sessionId: adv.sessionId };
}
