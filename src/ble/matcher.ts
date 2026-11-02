import type { Advertisement } from './types';
import { SIGNATURES, matchRule, type Signature, type RuleHit } from '../signatures';

export interface Match { signature: Signature; corroborated?: boolean; confidence: number; rssi?: number; timestamp: number; sessionId: string; hits?: RuleHit[]; }

/** All rule hits for one advert, with reasons (no payload bytes or identifiers in the reasons). */
export function hits(adv: Advertisement, sigs: Signature[] = SIGNATURES): RuleHit[] {
  const out: RuleHit[] = [];
  for (const s of sigs) { const reason = matchRule(s, adv); if (reason) out.push({ signature: s, reason }); }
  return out;
}

/** Returns the best match, fusing independent hits (1 - Π(1-c)). Weak signals nudged by RSSI. */
export function match(adv: Advertisement, sigs: Signature[] = SIGNATURES): Match | null {
  const all = hits(adv, sigs);
  if (!all.length) return null;
  const sh = all.map(h => h.signature);
  // flock-xuntong-cid is a generic OEM company ID: it never corroborates other rules and is boosted ONLY by a
  // Flock name hit here (or a Flock Wi-Fi SSID in the same cell, see fusion/gearFusion.ts).
  const flockName = sh.some(h => h.vendor === 'Flock Safety' && h.rule.kind === 'namePattern');
  let counted = flockName || sh.length === 1 ? sh : sh.filter(h => h.id !== 'flock-xuntong-cid');
  // Signatures in the same group are one piece of evidence: keep only the strongest of each group.
  const byGroup = new Map<string, Signature>();
  for (const s of counted) { const g = s.group ?? s.id; const p = byGroup.get(g); if (!p || s.baseConfidence > p.baseConfidence) byGroup.set(g, s); }
  counted = [...byGroup.values()];
  let conf = 1 - counted.reduce((p, s) => p * (1 - s.baseConfidence), 1);
  // Corroboration: hits from different rule kinds (e.g. company ID + service UUID) are much stronger evidence.
  const independent = new Set(counted.map(h => h.rule.kind)).size;
  if (independent >= 2) conf = Math.max(conf, 0.85);
  if (adv.rssi !== undefined && adv.rssi < -90) conf *= 0.85;
  const best = sh.reduce((a, b) => (b.baseConfidence > a.baseConfidence ? b : a));
  return { signature: best, corroborated: independent >= 2, confidence: Math.min(0.99, +conf.toFixed(2)), rssi: adv.rssi, timestamp: adv.timestamp, sessionId: adv.sessionId, hits: all };
}
