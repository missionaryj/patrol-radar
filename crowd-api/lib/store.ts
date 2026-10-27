import { TTL_MS, type CrowdReport } from './protocol';
/** Storage: Upstash Redis over REST when configured, else per-instance memory (ephemeral fallback). Never stores IPs. */
export interface Store {
  kind: string;
  add(r: CrowdReport, now: number): Promise<void>;
  list(now: number): Promise<CrowdReport[]>;
  incr(key: string, ttlS: number): Promise<number>;
  removeKind(kind: string): Promise<number>;
}
const env = (k: string) => (globalThis as any).process?.env?.[k] as string | undefined;
const KEY = 'crowd:reports';
const member = (r: CrowdReport) => JSON.stringify([r.cell.lat, r.cell.lng, r.bucket, r.kind, r.conf, r.reporter]);
const parse = (m: string): CrowdReport => { const [lat, lng, bucket, kind, conf, reporter] = JSON.parse(m); return { cell: { lat, lng }, bucket, kind, conf, reporter }; };

class RedisStore implements Store {
  kind = 'upstash-redis';
  constructor(private url: string, private token: string) {}
  private async cmd(...args: (string | number)[]) {
    const r = await fetch(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, body: JSON.stringify(args) });
    const j = await r.json() as any; if (j.error) throw new Error(j.error); return j.result;
  }
  private async pipe(cmds: (string | number)[][]) {
    const r = await fetch(`${this.url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, body: JSON.stringify(cmds) });
    return (await r.json() as any[]).map(x => x.result);
  }
  async add(r: CrowdReport, now: number) {
    await this.pipe([['ZREMRANGEBYSCORE', KEY, '-inf', now - TTL_MS], ['ZADD', KEY, r.bucket, member(r)], ['PEXPIRE', KEY, TTL_MS]]);
  }
  async list(now: number) {
    const [, res] = await this.pipe([['ZREMRANGEBYSCORE', KEY, '-inf', now - TTL_MS], ['ZRANGEBYSCORE', KEY, now - TTL_MS, '+inf']]);
    return (res as string[]).map(parse);
  }
  async incr(key: string, ttlS: number) { const [n] = await this.pipe([['INCR', key], ['EXPIRE', key, ttlS, 'NX']]); return n as number; }
  async removeKind(kind: string) {
    const all = (await this.cmd('ZRANGE', KEY, 0, -1)) as string[]; const del = all.filter(m => parse(m).kind === kind);
    return del.length ? (await this.cmd('ZREM', KEY, ...del)) as number : 0;
  }
}
class MemoryStore implements Store {
  kind = 'memory (ephemeral, per instance)';
  private recs = new Map<string, CrowdReport>(); private counters = new Map<string, { n: number; exp: number }>();
  async add(r: CrowdReport, now: number) { this.prune(now); this.recs.set(member(r), r); }
  async list(now: number) { this.prune(now); return [...this.recs.values()]; }
  async incr(key: string, ttlS: number) {
    const now = Date.now(); const c = this.counters.get(key); const e = c && c.exp > now ? c : { n: 0, exp: now + ttlS * 1000 };
    e.n++; this.counters.set(key, e); if (this.counters.size > 50_000) this.counters.clear(); return e.n;
  }
  async removeKind(kind: string) { let n = 0; for (const [k, r] of this.recs) if (r.kind === kind) { this.recs.delete(k); n++; } return n; }
  private prune(now: number) { for (const [k, r] of this.recs) if (r.bucket < now - TTL_MS) this.recs.delete(k); }
}
let store: Store | undefined;
export function getStore(): Store {
  if (store) return store;
  const url = env('UPSTASH_REDIS_REST_URL') ?? env('KV_REST_API_URL'); const token = env('UPSTASH_REDIS_REST_TOKEN') ?? env('KV_REST_API_TOKEN');
  return (store = url && token ? new RedisStore(url, token) : new MemoryStore());
}
