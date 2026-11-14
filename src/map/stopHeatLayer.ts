/** Historical traffic-stop heat: police beats or ~150 m cells, built by scripts/fetch-stop-heat.mjs.
 *  Extension point: this layer may later be gated behind a subscription. Do not add Play Billing or a paywall here.
 *  The settings toggle stays available so the layer can be tested. Counts only — never a person or a precise stop point. */
export const YEAR_BASE = 1990;
export const BUCKET = 56;
export const HEAT_GRID_MIN_ZOOM = 11;
export const HEAT_CELL_CAP = 1800;
export const STOP_HEAT_ATTRIBUTION = 'Stop history: <a href="https://openpolicing.stanford.edu/">Stanford Open Policing Project</a> (ODC-BY) and city open data. Chicago collapses identical rows and may still contain duplicate encounters. Urbana is a citywide total, not street locations. Coverage is uneven.';

export interface HeatTod { id: string; label: string; hint: string }
export interface HeatSource { id: string; name: string; url: string; license: string; last_updated: string | null; fetched: string; stops: number; mapped: number; unmapped: number; note?: string; disclaimer?: string; license_url?: string; audit?: { seen: number; accepted: number; duplicate_rows: number; rejected: number; time_range: [string, string] } }
export interface HeatGap { id: string; name: string; url: string; why: string }
export interface StopHeatIndex {
  generated: string; gridM: number; tileDeg: number; yearBase: number; years: number[];
  tod: HeatTod[]; dow: string[]; reasons: string[]; disclaimer: string; attribution: string;
  sources: HeatSource[]; notMapped: HeatGap[]; tiles: Record<string, number>; beatFiles: string[];
  totals: { stops: number; mapped: number; unmapped: number; beats: number; cells: number };
  coverage?: { states_with_records: string[]; population_of_jurisdictions: number; occupied_cell_footprint_m2: number; occupied_cell_us_area_percent: number };
}

export function coverageCaption(idx: StopHeatIndex) {
  const c = idx.coverage;
  if (!c) return 'Regional historical source records · coverage not measured';
  return `${c.states_with_records.length} states with records · ${(c.occupied_cell_footprint_m2 / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} km² occupied cell footprint · ${c.occupied_cell_us_area_percent.toFixed(4)}% of U.S. area. Jurisdictions have ${c.population_of_jurisdictions.toLocaleString()} residents (2020); this is not population coverage.`;
}
/** [lat, lng, src pairs, bucket pairs, outcome tuples, reason tuples] */
export type HeatCell = [number, number, number[], number[], number[], number[]];
export interface HeatFilter { year: number | null; tod: number | null; dow: number | null }
export const OPEN_FILTER: HeatFilter = { year: null, tod: null, dow: null };

const RAMP: [number, number, number][] = [[246, 214, 106], [244, 162, 80], [224, 96, 62], [155, 34, 38]];

export function heatPaint(n: number) {
  const t = n <= 1 ? 0 : Math.min(1, Math.log10(n) / 4);
  const x = t * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const rgb = RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f)) as [number, number, number];
  const fillOpacity = 0.22 + 0.48 * t;
  return { rgb, fillOpacity, stroke: `rgb(${rgb.join(',')})`, css: `rgba(${rgb.join(',')},${fillOpacity.toFixed(2)})` };
}

export interface HeatCount { n: number; cite: number; warn: number; arrest: number }
/** b is [pack, count, ...]. o is [pack, cite, warn, arrest, ...]. Pack matches scripts/stop-heat-lib.mjs. */
export function countBuckets(b: number[], o: number[] | undefined, f: HeatFilter, yearBase = YEAR_BASE): HeatCount {
  const oc = new Map<number, [number, number, number]>();
  if (o) for (let i = 0; i + 3 < o.length; i += 4) oc.set(o[i], [o[i + 1], o[i + 2], o[i + 3]]);
  let n = 0, cite = 0, warn = 0, arrest = 0;
  for (let i = 0; i + 1 < b.length; i += 2) {
    const pack = b[i];
    const yi = Math.floor(pack / BUCKET), rem = pack % BUCKET, tod = Math.floor(rem / 7), dow = rem % 7;
    if (f.year != null && yearBase + yi !== f.year) continue;
    if (f.tod != null && tod !== f.tod) continue;
    if (f.dow != null && dow !== f.dow) continue;
    n += b[i + 1];
    const row = oc.get(pack);
    if (row) { cite += row[0]; warn += row[1]; arrest += row[2]; }
  }
  return { n, cite, warn, arrest };
}

export function topReasons(r: number[], f: HeatFilter, labels: string[], yearBase = YEAR_BASE, limit = 3) {
  const m = new Map<number, number>();
  for (let i = 0; i + 2 < r.length; i += 3) {
    if (f.year != null && yearBase + r[i] !== f.year) continue;
    m.set(r[i + 1], (m.get(r[i + 1]) ?? 0) + r[i + 2]);
  }
  const total = [...m.values()].reduce((sum, n) => sum + n, 0);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([i, n]) => ({ label: labels[i] ?? 'other', n, total }));
}

export function filterCaption(f: HeatFilter, tod: HeatTod[], dow: string[]) {
  const bits = [f.year == null ? 'All years' : String(f.year), f.tod == null ? 'all hours' : `${tod[f.tod]?.label ?? ''} (${tod[f.tod]?.hint ?? ''})`, f.dow == null ? 'all days' : dow[f.dow] ?? ''];
  return bits.filter(Boolean).join(' · ');
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (part: number, n: number) => n ? Math.round(100 * part / n) : 0;

export interface HeatPopupInput {
  title: string; place?: string; count: HeatCount; reasons: { label: string; n: number; total?: number }[];
  filter: HeatFilter; caption: string; sources: Pick<HeatSource, 'name' | 'url' | 'license' | 'last_updated'>[];
  gridM?: number;
}
export function heatPopup(p: HeatPopupInput): string {
  const known = p.count.cite + p.count.warn + p.count.arrest;
  const share = ([['Citation', p.count.cite], ['Warning', p.count.warn], ['Arrest', p.count.arrest]] as [string, number][]).filter(([, n]) => n > 0);
  const reasons = p.reasons.filter(r => r.n > 0);
  const reasonSum = reasons[0]?.total ?? reasons.reduce((a, r) => a + r.n, 0);
  const srcs = p.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> (${esc(s.license)}${s.last_updated ? `, updated ${esc(s.last_updated)}` : ''})`).join('<br>');
  const where = p.place ? `${esc(p.title)} · ${esc(p.place)}` : esc(p.title);
  const reasonNote = p.filter.tod != null || p.filter.dow != null ? 'Reason mix follows the selected year, not the hour or weekday.' : '';
  return `<b>Historical stops</b><br>${where}<br><b>${p.count.n.toLocaleString()}</b> stops · ${esc(p.caption)}`
    + (share.length ? `<br>${share.map(([k, n]) => `${k} ${pct(n, known)}%`).join(' · ')}${known < p.count.n ? ' <small>(of stops that recorded an outcome)</small>' : ''}` : '')
    + (reasons.length ? `<br>Common reasons (of categorized stops): ${reasons.map(r => `${esc(r.label)} ${pct(r.n, reasonSum)}%`).join(', ')}` : '')
    + (reasonNote ? `<br><small>${reasonNote}</small>` : '')
    + `<br><small>${p.gridM ? `About a ${p.gridM} m cell` : 'Police beat or precinct'}, not one stop and not a live scan. Official data can be years behind. Coverage is uneven.</small>`
    + (srcs ? `<br><small>Source: ${srcs}</small>` : '');
}

export function heatTooltip(n: number) { return `${n.toLocaleString()} historical stops`; }

/** Tile keys overlapping bounds. Rounded so 0.25° steps match the files (plain addition drifts). */
export function heatTilesFor(idx: { tileDeg: number; tiles: Record<string, number> }, b: { south: number; west: number; north: number; east: number }) {
  const d = idx.tileDeg; const r = (n: number) => Math.round(n * 100) / 100; const out: string[] = [];
  for (let la = r(Math.floor(b.south / d) * d); la <= b.north + 1e-9; la = r(la + d))
    for (let ln = r(Math.floor(b.west / d) * d); ln <= b.east + 1e-9; ln = r(ln + d)) {
      const k = `${la}_${ln}`; if (k in idx.tiles) out.push(k);
    }
  return out;
}
export function sourcesFor(flat: number[], sources: HeatSource[]) {
  const out: HeatSource[] = [];
  for (let i = 0; i < flat.length; i += 2) { const s = sources[flat[i]]; if (s) out.push(s); }
  return out;
}
