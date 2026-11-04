#!/usr/bin/env node
// Builds the US "Traffic enforcement cameras" layer: public/data/traffic-cams/{index.json,<tile>.json}.
// Sources (all public, redistribution-friendly; see SOURCES below for licenses):
//   OpenStreetMap via Overpass (ODbL 1.0) for the whole US, plus official city open-data portals where they publish points.
// Usage: node scripts/fetch-traffic-cameras.mjs [--endpoint OVERPASS_URL] [--osm-file cached.json]
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';

export const TYPES = ['speed', 'red_light', 'school_zone', 'work_zone', 'monitor'];
export const TILE_DEG = 5;
export const DEDUPE_M = 30;
const UA = { 'User-Agent': 'patrol-radar-traffic-cam-export/1.0 (github.com/missionaryj/patrol-radar)' };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
export const OSM_QUERY = `[out:json][timeout:900];
area["ISO3166-1"="US"][admin_level=2]->.us;
( node["highway"="speed_camera"](area.us);
  node["man_made"="surveillance"]["surveillance:type"="camera"]["surveillance"="traffic"](area.us);
  node["man_made"="surveillance"]["surveillance:type"~"^(red_light_camera|speed_camera)$"](area.us);
  node["enforcement"](area.us); )->.n;
rel["type"="enforcement"](area.us)->.r;
(.n; .r; node(r.r:"device"););
out body;`;

/** Official portals. Each returns [{type, lat, lon, dir?, speed?}]. Order = priority in dedupe (official beats OSM). */
export const SOURCES = {
  chicago_rlc: { name: 'City of Chicago: Red Light Camera Locations', url: 'https://data.cityofchicago.org/d/thvf-6diy', license: 'City of Chicago Data Portal Terms of Use (public, free reuse)', meta: 'https://data.cityofchicago.org/api/views/thvf-6diy.json' },
  chicago_speed: { name: 'City of Chicago: Speed Camera Locations (Children\'s Safety Zones)', url: 'https://data.cityofchicago.org/d/4i42-qv3h', license: 'City of Chicago Data Portal Terms of Use (public, free reuse)', meta: 'https://data.cityofchicago.org/api/views/4i42-qv3h.json' },
  dc_asc: { name: 'DC DDOT: Automated Safety Cameras', url: 'https://opendata.dc.gov/datasets/DCGIS::automated-safety-cameras', license: 'CC BY 4.0', item: '03d94dc6579949ae9d7c9dd8ffebeb89', arcgis: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/FeatureServer/43' },
  seattle_atsc: { name: 'Seattle SDOT: Automatic Traffic Safety Cameras (Active)', url: 'https://data-seattlecitygis.opendata.arcgis.com/datasets/SeattleCityGIS::automatic-traffic-safety-cameras-atsc-active', license: 'City of Seattle open data (public; terms of use apply)', item: 'f3879db110b84473b4e3d669157c6a39', arcgis: 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Automatic_Traffic_Safety_Cameras_(ATSC)_view/FeatureServer/0' },
  arlington_rlc: { name: 'Arlington County VA: DES Photo Red Cameras', url: 'https://data.virginia.gov/dataset/des-photo-red-cameras', license: 'Arlington County open data (publicly available)', arcgis: 'https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data/od_DES_Signal_PhotoRED_Cameras_pnt/FeatureServer/0' },
  osm: { name: 'OpenStreetMap (Overpass API)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0, © OpenStreetMap contributors' },
};
const SRC_KEYS = Object.keys(SOURCES);

const DIR = { NB: 0, EB: 90, SB: 180, WB: 270, N: 0, E: 90, S: 180, W: 270 };
const dirOf = s => { const m = String(s ?? '').toUpperCase().match(/\b([NESW])\/?B?\b/); return m ? DIR[m[1]] : undefined; };
const getJSON = async (u, init) => { const r = await fetch(u, { ...init, headers: { ...UA, ...(init?.headers ?? {}) } }); if (!r.ok) throw new Error(`${u} HTTP ${r.status}`); return r.json(); };
async function arcgisAll(base, where = '1=1') {
  const out = []; for (let off = 0; ; off += 1000) {
    const j = await getJSON(`${base}/query?where=${encodeURIComponent(where)}&outFields=*&outSR=4326&f=geojson&resultOffset=${off}&resultRecordCount=1000`);
    out.push(...(j.features ?? [])); if (!(j.exceededTransferLimit || j.properties?.exceededTransferLimit) || !j.features?.length) return out;
  }
}
async function arcgisUpdated(base) { try { const j = await getJSON(`${base}?f=json`); const t = j.editingInfo?.dataLastEditDate ?? j.editingInfo?.lastEditDate; return t ? new Date(t).toISOString().slice(0, 10) : null; } catch { return null; } }
const xy = f => f.geometry?.coordinates ?? [];

export const FETCHERS = {
  async chicago_rlc() { const rows = await getJSON('https://data.cityofchicago.org/resource/thvf-6diy.json?$limit=5000');
    return rows.filter(r => r.latitude).map(r => ({ type: 'red_light', lat: +r.latitude, lon: +r.longitude, dir: dirOf(r.first_approach) })); },
  async chicago_speed() { const rows = await getJSON('https://data.cityofchicago.org/resource/4i42-qv3h.json?$limit=5000');
    return rows.filter(r => r.latitude).map(r => ({ type: 'speed', lat: +r.latitude, lon: +r.longitude, dir: dirOf(r.first_approach) })); },
  async dc_asc() { const fs = await arcgisAll(SOURCES.dc_asc.arcgis, "ACTIVE_STATUS='Active'");
    const T = { Speed: 'speed', 'Red Light': 'red_light' };
    return fs.filter(f => T[f.properties.ENFORCEMENT_TYPE] && f.properties.DEVICE_MOBILITY !== 'Portable').map(f => ({ type: T[f.properties.ENFORCEMENT_TYPE], lon: xy(f)[0], lat: xy(f)[1], dir: dirOf(f.properties.LOCATION_DESCRIPTION), speed: f.properties.SPEED_LIMIT || undefined })); },
  async seattle_atsc() { const fs = await arcgisAll(SOURCES.seattle_atsc.arcgis);
    const T = { 'Fixed School Zone': 'school_zone', 'Red Light': 'red_light', 'Speed': 'speed' }; // Block-the-Box / Transit Lane skipped (not speed/signal enforcement)
    return fs.filter(f => T[f.properties.Camera_Type]).map(f => ({ type: T[f.properties.Camera_Type], lat: f.properties.Cam_Lat ?? xy(f)[1], lon: f.properties.Cam_Long ?? xy(f)[0], dir: dirOf(f.properties.SPD_Camera_Name) })); },
  async arlington_rlc() { const fs = await arcgisAll(SOURCES.arlington_rlc.arcgis);
    const t = Math.max(0, ...fs.map(f => f.properties.GeoSyncDate ?? 0));
    return Object.assign(fs.filter(f => !f.properties.Retired).map(f => ({ type: 'red_light', lon: xy(f)[0], lat: xy(f)[1], dir: dirOf(f.properties.Direction) })), { updated: t ? new Date(t).toISOString().slice(0, 10) : null }); },
};

/** OSM element tags -> subtype, or null if not a traffic-enforcement / traffic-monitoring camera. */
export function classifyOsm(t = {}) {
  if (t['surveillance:type'] === 'ALPR') return null; // plate readers live in the Flock/ALPR layer
  const all = Object.entries(t).map(([k, v]) => `${k}=${v}`).join(' ').toLowerCase();
  const enf = (t.enforcement ?? '').toLowerCase();
  const red = /red_light|traffic.?signals/.test(enf) || t.surveillance === 'red_light' || t.highway === 'red_light_camera' || t['surveillance:type'] === 'red_light_camera';
  const speed = t.highway === 'speed_camera' || /maxspeed|speed|average_speed/.test(enf) || t.surveillance === 'average_speed' || t['surveillance:type'] === 'speed_camera';
  if (!red && !speed) return t.man_made === 'surveillance' && t['surveillance:type'] === 'camera' && t.surveillance === 'traffic' && !enf ? 'monitor' : null;
  if (/work.?zone|construction/.test(all)) return 'work_zone';
  if (/school/.test(all)) return 'school_zone';
  return red ? 'red_light' : 'speed';
}
export function fromOsm(osm) {
  const nodes = new Map(osm.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  const out = [], used = new Set();
  for (const r of osm.elements.filter(e => e.type === 'relation')) {
    const ty = classifyOsm({ ...r.tags, type: undefined });
    if (!ty || ty === 'monitor') continue;
    for (const m of r.members ?? []) if (m.type === 'node' && m.role === 'device' && nodes.has(m.ref)) {
      const n = nodes.get(m.ref); used.add(n.id); const nt = classifyOsm(n.tags);
      out.push({ type: nt && nt !== 'monitor' ? nt : ty, lat: n.lat, lon: n.lon, id: n.id, dir: num(n.tags?.direction ?? n.tags?.['camera:direction']), speed: mph(r.tags?.maxspeed ?? n.tags?.maxspeed) });
    }
  }
  for (const n of nodes.values()) { if (used.has(n.id)) continue; const ty = classifyOsm(n.tags); if (ty) out.push({ type: ty, lat: n.lat, lon: n.lon, id: n.id, dir: num(n.tags?.direction ?? n.tags?.['camera:direction']), speed: mph(n.tags?.maxspeed) }); }
  return out;
}
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n) : dirOf(v); };
const mph = v => { const m = String(v ?? '').match(/(\d+)\s*mph/i); return m ? +m[1] : undefined; };

/** Haversine-free equirectangular distance in metres (fine at 30 m). */
const distM = (a, b) => { const k = 111_320, dx = (a.lon - b.lon) * k * Math.cos(a.lat * Math.PI / 180), dy = (a.lat - b.lat) * k; return Math.hypot(dx, dy); };
/** Keep the first point (sources are passed in priority order) and drop later ones within `m` metres of the same type,
 *  or any type when the later one is only a generic monitoring camera. */
export function dedupe(points, m = DEDUPE_M) {
  const grid = new Map(), cell = m / 111_320, key = (la, lo) => `${Math.floor(la / cell)}_${Math.floor(lo / cell)}`, out = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const gi = Math.floor(p.lat / cell), gj = Math.floor(p.lon / cell); let dup = false;
    for (let a = -1; a <= 1 && !dup; a++) for (let b = -2; b <= 2 && !dup; b++) for (const q of grid.get(`${gi + a}_${gj + b}`) ?? [])
      if ((q.type === p.type || p.type === 'monitor') && distM(p, q) <= m) { dup = true; break; }
    if (!dup) { out.push(p); const k = key(p.lat, p.lon); (grid.get(k) ?? grid.set(k, []).get(k)).push(p); }
  }
  return out;
}
export const tileKey = (lat, lon) => `${Math.floor(lat / TILE_DEG) * TILE_DEG}_${Math.floor(lon / TILE_DEG) * TILE_DEG}`;
/** Compact row: [lon, lat, typeIdx, srcIdx, dir|null, speedMph|null, osmId|null] (4 dp ≈ 11 m). */
export const pack = p => { const r = [+p.lon.toFixed(4), +p.lat.toFixed(4), TYPES.indexOf(p.type), SRC_KEYS.indexOf(p.source), p.dir ?? null, p.speed ?? null, p.id ?? null]; while (r.length > 4 && r[r.length - 1] === null) r.pop(); return r; };

export function build(points, meta) {
  const pts = dedupe(points); const tiles = {}, counts = { byType: {}, bySource: {} };
  for (const p of pts) { (tiles[tileKey(p.lat, p.lon)] ??= []).push(pack(p)); counts.byType[p.type] = (counts.byType[p.type] ?? 0) + 1; counts.bySource[p.source] = (counts.bySource[p.source] ?? 0) + 1; }
  return { index: { generated: new Date().toISOString(), count: pts.length, rawCount: points.length, dedupeM: DEDUPE_M, tileDeg: TILE_DEG, types: TYPES, sources: SRC_KEYS.map(k => ({ id: k, ...meta[k] })), counts, tiles: Object.fromEntries(Object.entries(tiles).map(([k, v]) => [k, v.length])) }, tiles };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = f => process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : undefined;
  const all = [], meta = {};
  for (const k of SRC_KEYS.filter(k => k !== 'osm')) {
    const s = SOURCES[k]; let updated = null;
    try {
      const pts = await FETCHERS[k]();
      if (s.meta) { const j = await getJSON(s.meta); updated = j.rowsUpdatedAt ? new Date(j.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : null; }
      else if (s.item) { const j = await getJSON(`https://www.arcgis.com/sharing/rest/content/items/${s.item}?f=json`); updated = j.modified ? new Date(j.modified).toISOString().slice(0, 10) : null; }
      if (!updated && pts.updated) updated = pts.updated;
      if (!updated && s.arcgis) updated = await arcgisUpdated(s.arcgis);
      for (const p of pts) all.push({ ...p, source: k }); console.log(`${k}: ${pts.length}`);
    } catch (e) { console.warn(`${k} failed: ${e.message}`); }
    meta[k] = { name: s.name, url: s.url, license: s.license, last_updated: updated, fetched: new Date().toISOString().slice(0, 10) };
  }
  let osm;
  if (arg('--osm-file')) osm = JSON.parse(readFileSync(arg('--osm-file'), 'utf8'));
  else for (const ep of arg('--endpoint') ? [arg('--endpoint')] : OVERPASS) {
    try { osm = await getJSON(ep, { method: 'POST', body: new URLSearchParams({ data: OSM_QUERY }) }); console.log(`overpass ok: ${ep}`); break; } catch (e) { console.warn(`overpass ${ep}: ${e.message}`); }
  }
  if (!osm) { console.error('no Overpass endpoint answered'); process.exit(1); }
  const o = fromOsm(osm); for (const p of o) all.push({ ...p, source: 'osm' }); console.log(`osm: ${o.length}`);
  meta.osm = { ...SOURCES.osm, last_updated: osm.osm3s?.timestamp_osm_base?.slice(0, 10) ?? null, fetched: new Date().toISOString().slice(0, 10) };
  const { index, tiles } = build(all, meta);
  const dir = 'public/data/traffic-cams'; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  for (const [k, rows] of Object.entries(tiles)) writeFileSync(`${dir}/${k}.json`, JSON.stringify(rows));
  writeFileSync(`${dir}/index.json`, JSON.stringify(index, null, 1));
  console.log(JSON.stringify({ count: index.count, raw: index.rawCount, ...index.counts }, null, 1));
}
