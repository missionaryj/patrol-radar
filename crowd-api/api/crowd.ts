import { validateReport, aggregate, DEFAULT_DELAY_MS, BUCKET_MS, TEST_KIND } from '../lib/protocol';
import { getStore } from '../lib/store';
import { cors, ipKey, isTest, json } from '../lib/http';
export const config = { runtime: 'edge' };
const PER_REPORTER_PER_MIN = 6, PER_IP_PER_MIN = 20, PER_CELL_PER_BUCKET = 25;
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const test = isTest(req);
  if (req.method === 'DELETE' && test) return json(req, { removed: await getStore().removeKind(new URL(req.url).searchParams.get('kind') ?? '') });
  if (req.method === 'GET') return cells(req);
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);
  const text = await req.text(); if (text.length > 512) return json(req, { error: 'payload too large' }, 413);
  let body: unknown; try { body = JSON.parse(text); } catch { return json(req, { error: 'invalid json' }, 400); }
  const now = Date.now(); const v = validateReport(body, now, { allowTest: test });
  if (!v.ok) return json(req, { error: v.error }, 400);
  const s = getStore(); const min = Math.floor(now / 60_000); const r = v.report;
  if ((await s.incr(`rl:ip:${await ipKey(req)}:${min}`, 120)) > PER_IP_PER_MIN) return json(req, { error: 'rate limited' }, 429);
  if ((await s.incr(`rl:rep:${r.reporter}:${min}`, 120)) > PER_REPORTER_PER_MIN) return json(req, { error: 'rate limited' }, 429);
  if ((await s.incr(`cap:${r.cell.lat},${r.cell.lng}:${r.bucket}`, 7200)) > PER_CELL_PER_BUCKET) return json(req, { ok: true, capped: true }, 202);
  await s.add(r, now);
  return json(req, { ok: true }, 202);
}

/** Public read: aggregated cells only (no reporter tokens), delayed >= 12 min. Test key adds test data and can bypass the delay. */
async function cells(req: Request) {
  const now = Date.now(); const s = getStore(); const test = isTest(req); const q = new URL(req.url).searchParams;
  const evalAt = test && q.get('nodelay') === '1' ? now + DEFAULT_DELAY_MS + BUCKET_MS : now;
  let cells = aggregate(await s.list(now), evalAt, { includeTest: test });
  if (test && q.get('only') === 'test') cells = cells.filter(c => c.kind === TEST_KIND);
  return json(req, { cells, delayMinutes: DEFAULT_DELAY_MS / 60_000, storage: s.kind, generated: now });
}
