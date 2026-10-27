/**
 * Crowd-map wire protocol, shared by the client and the API (crowd-api/lib/protocol.ts is a byte-identical copy;
 * a test enforces that). No imports so it can be copied verbatim.
 *
 * A report is ONLY: coarse grid cell, 5-min time bucket, gear kind, confidence bucket, per-session random reporter token.
 * Never: device hashes, MACs, RSSI, precise location, identity, transcripts.
 */
export const GRID_M = 200;                 // within the 150-250 m privacy band
export const BUCKET_MS = 5 * 60_000;
export const MIN_DELAY_MS = 10 * 60_000;   // public reads are never fresher than this
export const DEFAULT_DELAY_MS = 12 * 60_000;
export const TTL_MS = 2 * 60 * 60_000;     // records expire after ~2 h
export const MAX_AGE_MS = 30 * 60_000;     // reports older than this are rejected
export const MAX_FUTURE_MS = 60_000;       // clock-skew allowance
export const KINDS = ['body-camera', 'cew', 'radio', 'vehicle', 'printer', 'other'] as const;
export const TEST_KIND = 'test-fake';      // only accepted with the server test key; never served publicly
export type Kind = (typeof KINDS)[number] | typeof TEST_KIND;
export const CONF_BUCKETS = ['low', 'med', 'high'] as const;
export type ConfBucket = (typeof CONF_BUCKETS)[number];
export const ALLOWED_FIELDS = ['cell', 'bucket', 'kind', 'conf', 'reporter'] as const;
/** Contiguous-US bounds. */
export const BOUNDS = { minLat: 24.4, maxLat: 49.5, minLng: -125, maxLng: -66.9 };

export interface CrowdReport { cell: { lat: number; lng: number }; bucket: number; kind: Kind; conf: ConfBucket; reporter: string; }
export interface CrowdCell { lat: number; lng: number; kind: Kind; reporters: number; conf: ConfBucket; last: number; confirmed: boolean; }

export function snapCell(lat: number, lng: number) {
  const dLat = GRID_M / 111_320; const sl = Math.round(lat / dLat) * dLat;
  const dLng = GRID_M / (111_320 * Math.cos((sl * Math.PI) / 180));
  return { lat: +sl.toFixed(5), lng: +(Math.round(lng / dLng) * dLng).toFixed(5) };
}
export const toBucket = (t: number) => Math.floor(t / BUCKET_MS) * BUCKET_MS;
export const confBucket = (c: number): ConfBucket => (c >= 0.8 ? 'high' : c >= 0.5 ? 'med' : 'low');
const CONF_RANK: Record<ConfBucket, number> = { low: 0, med: 1, high: 2 };

export function newReporterToken(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/** Build the exact upload payload. Input may be precise; only the snapped cell leaves. */
export function buildReport(i: { lat: number; lng: number; time: number; kind: string; confidence: number; reporter: string }): CrowdReport {
  const kind = (KINDS as readonly string[]).includes(i.kind) ? (i.kind as Kind) : 'other';
  return { cell: snapCell(i.lat, i.lng), bucket: toBucket(i.time), kind, conf: confBucket(i.confidence), reporter: i.reporter };
}

export type Validation = { ok: true; report: CrowdReport } | { ok: false; error: string };
export function validateReport(body: unknown, now: number, opts: { allowTest?: boolean } = {}): Validation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter(k => !(ALLOWED_FIELDS as readonly string[]).includes(k));
  if (extra.length) return { ok: false, error: `unexpected fields: ${extra.join(',')}` };
  const c = b.cell as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object' || Object.keys(c).sort().join() !== 'lat,lng') return { ok: false, error: 'cell must be {lat,lng}' };
  const lat = c.lat, lng = c.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return { ok: false, error: 'bad cell' };
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return { ok: false, error: 'cell outside service area' };
  const s = snapCell(lat, lng);
  if (Math.abs(s.lat - lat) > 2e-5 || Math.abs(s.lng - lng) > 2e-5) return { ok: false, error: 'cell not on grid' };
  const bucket = b.bucket;
  if (typeof bucket !== 'number' || !Number.isInteger(bucket) || bucket % BUCKET_MS !== 0) return { ok: false, error: 'bad bucket' };
  if (bucket > now + MAX_FUTURE_MS) return { ok: false, error: 'bucket in future' };
  if (bucket < now - MAX_AGE_MS) return { ok: false, error: 'bucket too old' };
  const kind = b.kind;
  const testOk = opts.allowTest && kind === TEST_KIND;
  if (typeof kind !== 'string' || (!(KINDS as readonly string[]).includes(kind) && !testOk)) return { ok: false, error: 'bad kind' };
  if (typeof b.conf !== 'string' || !(CONF_BUCKETS as readonly string[]).includes(b.conf)) return { ok: false, error: 'bad conf' };
  if (typeof b.reporter !== 'string' || !/^[0-9a-f]{32}$/.test(b.reporter)) return { ok: false, error: 'bad reporter token' };
  return { ok: true, report: { cell: s, bucket, kind: kind as Kind, conf: b.conf as ConfBucket, reporter: b.reporter } };
}

/** Aggregate stored reports into public cells: drops anything newer than the delay, expired records and (unless includeTest) test data. */
export function aggregate(reports: CrowdReport[], now: number, o: { delayMs?: number; includeTest?: boolean } = {}): CrowdCell[] {
  const delay = Math.max(MIN_DELAY_MS, o.delayMs ?? DEFAULT_DELAY_MS);
  const g = new Map<string, { r: Set<string>; conf: ConfBucket; last: number; lat: number; lng: number; kind: Kind }>();
  for (const r of reports) {
    if (r.kind === TEST_KIND && !o.includeTest) continue;
    if (r.bucket + BUCKET_MS > now - delay) continue;   // whole bucket must be older than the delay
    if (r.bucket < now - TTL_MS) continue;
    const k = `${r.cell.lat},${r.cell.lng},${r.kind}`;
    const e = g.get(k) ?? { r: new Set<string>(), conf: 'low' as ConfBucket, last: 0, lat: r.cell.lat, lng: r.cell.lng, kind: r.kind };
    e.r.add(r.reporter); if (CONF_RANK[r.conf] > CONF_RANK[e.conf]) e.conf = r.conf; e.last = Math.max(e.last, r.bucket); g.set(k, e);
  }
  return [...g.values()].map(e => ({ lat: e.lat, lng: e.lng, kind: e.kind, reporters: e.r.size, conf: e.conf, last: e.last, confirmed: e.r.size >= 2 || e.conf === 'high' }));
}
