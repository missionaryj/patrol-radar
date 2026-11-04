/** Traffic enforcement cameras (speed / red-light / school-zone / work-zone / traffic monitoring). Static, display only.
 *  Built by scripts/fetch-traffic-cameras.mjs from OpenStreetMap (ODbL) + official city open data. */
export type TcType = 'speed' | 'red_light' | 'school_zone' | 'work_zone' | 'monitor';
export const TC_TYPES: TcType[] = ['speed', 'red_light', 'school_zone', 'work_zone', 'monitor'];
export const TC_META: Record<TcType, { label: string; short: string; glyph: string; color: string }> = {
  speed: { label: 'Automated speed camera', short: 'Speed', glyph: 'S', color: '#f59e0b' },
  red_light: { label: 'Red-light camera', short: 'Red-light', glyph: 'R', color: '#ef4444' },
  school_zone: { label: 'School-zone camera', short: 'School zone', glyph: 'Z', color: '#eab308' },
  work_zone: { label: 'Work-zone enforcement', short: 'Work zone', glyph: 'W', color: '#f97316' },
  monitor: { label: 'Fixed traffic monitoring camera', short: 'Monitoring', glyph: 'M', color: '#64748b' },
};
export const TC_MIN_ZOOM = 11;
export const TC_CAP = 1200;
export const TC_ATTRIBUTION = 'Traffic cams: © <a href="https://www.openstreetmap.org/copyright">OSM</a> (ODbL) + city open data';
export interface TcSource { id: string; name: string; url: string; license: string; last_updated: string | null; fetched: string }
export interface TcIndex { generated: string; count: number; tileDeg: number; types: TcType[]; sources: TcSource[]; counts: { byType: Record<string, number> }; tiles: Record<string, number> }
/** [lon, lat, typeIdx, srcIdx, dir?, speedMph?, osmId?] */
export type TcRow = [number, number, number, number, (number | null)?, (number | null)?, (number | null)?];
export interface TcPoint { lat: number; lng: number; type: TcType; source: TcSource; dir?: number; speed?: number; osmId?: number }
export const tcIcon = (t: TcType) => `<i class="tcam tcam-${t}" style="background:${TC_META[t].color}">${TC_META[t].glyph}</i>`;
export function unpack(r: TcRow, idx: TcIndex): TcPoint {
  return { lng: r[0], lat: r[1], type: idx.types[r[2]], source: idx.sources[r[3]], dir: r[4] ?? undefined, speed: r[5] ?? undefined, osmId: r[6] ?? undefined };
}
export function tcInBounds(rows: TcRow[], idx: TcIndex, b: { south: number; west: number; north: number; east: number }, cap = TC_CAP, enabled?: Set<TcType>) {
  const out: TcPoint[] = [];
  for (const r of rows) if (r[1] >= b.south && r[1] <= b.north && r[0] >= b.west && r[0] <= b.east) {
    const p = unpack(r, idx); if (enabled && !enabled.has(p.type)) continue; out.push(p); if (out.length >= cap) break;
  }
  return out;
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export function tcPopup(p: TcPoint): string {
  const m = TC_META[p.type], s = p.source;
  const link = p.osmId ? `https://www.openstreetmap.org/node/${p.osmId}` : s.url;
  return `${tcIcon(p.type)} <b>${m.label}</b>${p.speed ? `<br>Limit ${p.speed} mph` : ''}${p.dir !== undefined ? `<br>Facing ${p.dir}°` : ''}`
    + `<br><small>Source: <a href="${esc(link)}" target="_blank" rel="noopener">${esc(s.name)}</a> (${esc(s.license)})<br>Last updated: ${s.last_updated ?? 'unknown'} · fetched ${s.fetched}<br>Mapped location, not a scan hit. May be inactive or moved.</small>`;
}
