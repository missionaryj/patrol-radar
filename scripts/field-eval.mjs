#!/usr/bin/env node
/**
 * Field evaluation: node scripts/field-eval.mjs <folder-of-debug-json> [--json]
 * Reads Patrol Radar debug exports (schema v3 carries header.fieldLabel + signatureHits; v1/v2 files count as "unlabeled").
 * Per session label (police-present / not-present / unsure / unlabeled) and per signature it reports:
 *   hit rate        = labeled police-present sessions where the signature fired / all police-present sessions
 *   miss rate       = police-present sessions where it did NOT fire
 *   false-pos rate  = not-present sessions where it fired / all not-present sessions
 * plus app-level detection (any signature fired) on the same basis. Uses only rule ids and counts: no device ids leave the files.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2); const dir = args.find(a => !a.startsWith('--')); const asJson = args.includes('--json');
if (!dir) { console.error('usage: node scripts/field-eval.mjs <folder> [--json]'); process.exit(2); }
const files = []; const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.json')) files.push(p); } }; walk(dir);

const sessions = [];
for (const f of files) {
  let o; try { o = JSON.parse(readFileSync(f, 'utf8')); } catch { console.error(`skip ${f}: not JSON`); continue; }
  if (o?.header?.app !== 'patrol-radar') { console.error(`skip ${f}: not a Patrol Radar export`); continue; }
  const label = o.header.fieldLabel?.value ?? 'unlabeled';
  const sig = new Map();
  if (Array.isArray(o.signatureHits)) for (const h of o.signatureHits) sig.set(h.id, { tier: h.tier ?? '?', records: h.records ?? 0, devices: h.devices ?? 0 });
  else for (const r of o.records ?? []) for (const id of r.rules ?? []) { const s = sig.get(id) ?? { tier: '?', records: 0, devices: 0 }; s.records++; sig.set(id, s); } // v1/v2
  sessions.push({ file: f, label, schema: o.header.schemaVersion ?? 1, sig, adverts: o.health?.advertsSeen ?? null });
}
const LABELS = ['police-present', 'not-present', 'unsure', 'unlabeled'];
const byLabel = Object.fromEntries(LABELS.map(l => [l, sessions.filter(s => s.label === l)]));
const ids = [...new Set(sessions.flatMap(s => [...s.sig.keys()]))].sort();
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
const P = byLabel['police-present'], N = byLabel['not-present'];
const rows = ids.map(id => {
  const tier = sessions.map(s => s.sig.get(id)?.tier).find(t => t && t !== '?') ?? '?';
  const fired = l => byLabel[l].filter(s => s.sig.has(id)).length;
  return { id, tier, hitRate: pct(fired('police-present'), P.length), missRate: pct(P.length - fired('police-present'), P.length), falsePosRate: pct(fired('not-present'), N.length),
    sessionsFired: Object.fromEntries(LABELS.map(l => [l, fired(l)])), records: sessions.reduce((a, s) => a + (s.sig.get(id)?.records ?? 0), 0) };
});
const anyP = P.filter(s => s.sig.size).length, anyN = N.filter(s => s.sig.size).length;
const overall = { sessions: sessions.length, perLabel: Object.fromEntries(LABELS.map(l => [l, byLabel[l].length])), detectionRate: pct(anyP, P.length), missRate: pct(P.length - anyP, P.length), falsePosRate: pct(anyN, N.length) };
if (asJson) { console.log(JSON.stringify({ overall, signatures: rows }, null, 2)); process.exit(0); }
console.log(`Sessions: ${overall.sessions}  (${LABELS.map(l => `${l} ${overall.perLabel[l]}`).join(', ')})`);
const f = v => (v === null ? '  n/a' : `${v.toFixed(1).padStart(5)}%`);
console.log(`Any signature: hit ${f(overall.detectionRate)}  miss ${f(overall.missRate)}  false-pos ${f(overall.falsePosRate)}`);
console.log('\nsignature                     tier    hit     miss    false-pos  fired P/N/U/?  records');
for (const r of rows) console.log(`${r.id.padEnd(30)}${r.tier.padEnd(7)}${f(r.hitRate)}  ${f(r.missRate)}  ${f(r.falsePosRate)}     ${LABELS.map(l => r.sessionsFired[l]).join('/').padEnd(14)} ${r.records}`);
if (!P.length || !N.length) console.log('\nNote: label at least one "police present" and one "not present" session to get hit/miss and false-positive rates.');
