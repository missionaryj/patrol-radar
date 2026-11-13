// Historical traffic-stop aggregation. Privacy rules for this file:
// - Callers pass only safe fields (see makeStop). Person columns are refused.
// - Coordinates are snapped to GRID_M (150–250 m) unless they fall in a beat polygon.
// - Nothing written here is a raw stop row. Output is counts by beat or grid cell.
import { gunzipSync } from 'node:zlib';

/** Must stay inside the app's 150–250 m privacy band. Coarser than a street address. */
export const GRID_M = 150;
/** Grid tiles are 0.25° so a street-level view does not download a whole 5° block of cells. */
export const TILE_DEG = 0.25;
export const YEAR_BASE = 1990;
/** 8 time-of-day slots (0–5 named, 6 = time missing, 7 unused) × 7 weekdays. */
export const BUCKET = 56;
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const TOD = [
  { id: 'night', label: 'Night', hint: '12–4a' },
  { id: 'early', label: 'Early', hint: '4–8a' },
  { id: 'morning', label: 'Morning', hint: '8a–12p' },
  { id: 'afternoon', label: 'Afternoon', hint: '12–4p' },
  { id: 'evening', label: 'Evening', hint: '4–8p' },
  { id: 'late', label: 'Late', hint: '8p–12a' },
];
export const REASONS = ['speeding', 'signal', 'stop sign', 'equipment', 'seat belt', 'license', 'registration', 'insurance', 'phone', 'lane', 'pedestrian', 'impairment', 'investigatory', 'other'];
const REASON_INDEX = new Map(REASONS.map((r, i) => [r, i]));

const PII_KEY = /(officer|badge|subject|driver|ssn|dob|birth|address|incident|first_?name|last_?name|raw_row|georeference|mapping_address|dl_|vin\b|plate|email|race|sex|gender|\bage\b|vehicle_make|vehicle_model|search_basis|anonymous_house|frisk_conducted|search_conducted_by)/i;
const KNOWN = new Set(['year', 'dow', 'hour', 'lat', 'lng', 'beatId', 'cite', 'warn', 'arrest', 'reason', 'src']);
const LONG_OK = new Set(['disclaimer', 'note', 'license', 'name', 'url', 'why', 'attribution', 'label', 'place']);

const RULES = [
  [/dui|impair|intoxic|drunk|\balcohol\b|0\.08/, 'impairment'],
  [/speed/, 'speeding'],
  [/stop sign|stop-sign/, 'stop sign'],
  [/red light|red signal|circular steady|traffic signal|disobey.*signal|steady signal|\bsignal\b/, 'signal'],
  [/seat ?belt|child (safety )?seat|restraint/, 'seat belt'],
  [/phone|texting|handheld|electronic device|cell ?phone/, 'phone'],
  [/head ?light|tail ?light|\blamp\b|plate light|equipment|muffler|windshield|\btint\b|bumper/, 'equipment'],
  [/licen[sc]e|suspended|revoked|never issued|unlicensed/, 'license'],
  [/regist|sticker|plate expir|\btags?\b/, 'registration'],
  [/insur/, 'insurance'],
  [/pedestrian|crosswalk/, 'pedestrian'],
  [/lane|following too|turn signal|improper turn|\byield\b|right of way|one way/, 'lane'],
  [/drug|contraband|weapon|suspicious|casing|\bgang\b|fits description|proximity|radio call/, 'investigatory'],
];

export function reasonIndex(name) { const i = REASON_INDEX.get(name); if (i == null) throw new Error('reason ' + name); return i; }

/** Map a published violation phrase to a short category. Raw text is not returned. */
export function classifyReason(text) {
  const s = String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s || /^(na|n\/a|none|not applicable|unknown|null)$/.test(s)) return null;
  for (const [re, name] of RULES) if (re.test(s)) return reasonIndex(name);
  return reasonIndex('other');
}

export function parseCSVLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Calendar date -> year + Sunday=0 weekday. Time zones do not shift the civil date. */
export function partsFromDate(s) {
  if (s == null) return null;
  const t = String(s).trim();
  let y, m, d;
  let a = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (a) { y = +a[1]; m = +a[2]; d = +a[3]; }
  else {
    a = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!a) return null;
    m = +a[1]; d = +a[2]; y = +a[3];
  }
  if (y < YEAR_BASE || y > YEAR_BASE + 60 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return { year: y, dow: date.getUTCDay() };
}

export function parseHour(s) {
  if (s == null) return null;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = +m[1];
  if (+m[2] > 59 || (m[3] != null && +m[3] > 59)) return null;
  if (m[4]) { if (h < 1 || h > 12) return null; h = h % 12 + (m[4].toUpperCase() === 'PM' ? 12 : 0); }
  return h >= 0 && h <= 23 ? h : null;
}

export function flag(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 't' || s === 'yes' || s === 'y' || s === '1';
}

export function normCode(v) {
  const s = String(v ?? '').trim();
  if (!s || /^n\/?a$/i.test(s) || s === 'null' || s === 'undefined' || s === '0') return '';
  if (/^\d+$/.test(s)) return String(parseInt(s, 10));
  return s.toUpperCase();
}

export function validLL(lat, lng) {
  // Source-specific Census polygons establish jurisdiction, including Alaska's
  // Aleutians; a continental-US bounding box is not geographic validation.
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

/** ~GRID_M metres. Longitude step uses the snapped latitude so every point in a row shares one cell. */
export function snap(lat, lng, meters = GRID_M) {
  const dLat = meters / 111_320;
  const slat = Math.round(lat / dLat) * dLat;
  const dLng = meters / (111_320 * Math.cos((slat * Math.PI) / 180));
  return { lat: slat, lng: Math.round(lng / dLng) * dLng };
}

const tileNum = n => Math.round(n * 100) / 100;
export function tileKey(lat, lng) {
  return `${tileNum(Math.floor(lat / TILE_DEG) * TILE_DEG)}_${tileNum(Math.floor(lng / TILE_DEG) * TILE_DEG)}`;
}

export function packBucket(year, tod, dow) {
  return (year - YEAR_BASE) * BUCKET + tod * 7 + dow;
}

/** Refuse person-identifying keys. Only the known aggregate inputs are copied. */
export function makeStop(fields) {
  for (const k of Object.keys(fields)) {
    if (PII_KEY.test(k)) throw new Error('refusing personally identifying field ' + k);
    if (!KNOWN.has(k)) throw new Error('unknown stop field ' + k);
  }
  const hour = fields.hour == null || fields.hour === '' ? null : fields.hour;
  return {
    year: fields.year | 0,
    dow: fields.dow | 0,
    hour: hour == null ? null : hour | 0,
    lat: fields.lat == null || fields.lat === '' ? null : +fields.lat,
    lng: fields.lng == null || fields.lng === '' ? null : +fields.lng,
    beatId: fields.beatId ? String(fields.beatId) : '',
    cite: fields.cite ? 1 : 0,
    warn: fields.warn ? 1 : 0,
    arrest: fields.arrest ? 1 : 0,
    reason: fields.reason == null ? null : fields.reason | 0,
    src: fields.src | 0,
  };
}

export function outcomesFrom(row) {
  const o = String(row.outcome ?? '').toLowerCase();
  const vt = String(row.violation_type ?? '').toLowerCase();
  const cite = flag(row.citation_issued) || flag(row.summon_issued_flg) || /citation|summon/.test(o) || /citation|summon|sero/.test(vt);
  const warn = flag(row.warning_issued) || /warning/.test(o) || /warning/.test(vt);
  const arrest = flag(row.arrest_made) || flag(row.arrest_made_flg) || o === 'arrest' || /arrest/.test(o);
  return { cite: cite ? 1 : 0, warn: warn ? 1 : 0, arrest: arrest ? 1 : 0 };
}

function ringBBox(rings) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}

export function pointInRings(lng, lat, rings) {
  let c = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

export class Spatial {
  constructor(beats, cell = 0.05) {
    this.cell = cell; this.buckets = new Map();
    for (const b of beats) {
      const [w, s, e, n] = b.bbox;
      for (let x = Math.floor(w / cell); x <= Math.floor(e / cell); x++) for (let y = Math.floor(s / cell); y <= Math.floor(n / cell); y++) {
        const k = x + ':' + y; let a = this.buckets.get(k); if (!a) { a = []; this.buckets.set(k, a); } a.push(b);
      }
    }
  }
  hit(lng, lat) {
    const a = this.buckets.get(Math.floor(lng / this.cell) + ':' + Math.floor(lat / this.cell));
    if (!a) return null;
    for (const b of a) {
      const [w, s, e, n] = b.bbox;
      if (lng < w || lng > e || lat < s || lat > n) continue;
      if (pointInRings(lng, lat, b.rings)) return b;
    }
    return null;
  }
}

export class BeatSet {
  constructor(prefix, place, labelOf = code => 'Beat ' + code) {
    this.prefix = prefix; this.place = place; this.labelOf = labelOf; this.byCode = new Map(); this.list = [];
  }
  add(code, rings, label) {
    const n = normCode(code);
    if (!n || !rings?.length) return;
    let b = this.byCode.get(n);
    if (!b) {
      b = { id: `${this.prefix}:${n}`, code: n, place: this.place, label: label || this.labelOf(code), rings: [] };
      this.byCode.set(n, b); this.list.push(b);
    }
    b.rings.push(...rings);
    b.bbox = ringBBox(b.rings);
  }
}

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function simplifyRing(points, tol) {
  if (!points || points.length < 4) return points ? points.slice() : [];
  const closed = points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1];
  const core = closed ? points.slice(0, -1) : points.slice();
  if (core.length < 3) return [];
  const keep = new Uint8Array(core.length); keep[0] = keep[core.length - 1] = 1;
  const stack = [[0, core.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const d = distSeg(core[i], core[s], core[e]); if (d > max) { max = d; idx = i; } }
    if (idx >= 0 && max > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  const out = [];
  for (let i = 0; i < core.length; i++) if (keep[i]) out.push(core[i]);
  if (out.length < 3) return [];
  out.push(out[0].slice());
  return out;
}

const r5 = n => Math.round(n * 1e5) / 1e5;
function roundRing(ring) { return ring.map(([x, y]) => [r5(x), r5(y)]); }

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

/** Group rings into polygons with holes (a ring inside another is a hole). */
export function ringsToGeometry(rings, tol = 0.0003) {
  const items = [];
  for (const ring of rings) {
    const s = simplifyRing(ring, tol);
    const use = s.length >= 4 ? s : (ring.length >= 4 && ring.length <= 80 ? ring : []);
    if (use.length < 4) continue;
    const r = roundRing(use);
    items.push({ r, area: Math.abs(ringArea(r)) });
  }
  items.sort((a, b) => b.area - a.area);
  const polys = [];
  for (const it of items) {
    let parent = null;
    for (const p of polys) if (pointInRings(it.r[0][0], it.r[0][1], [p.outer]) && (!parent || p.area < parent.area)) parent = p;
    if (parent) parent.holes.push(it.r);
    else polys.push({ outer: it.r, holes: [], area: it.area });
  }
  if (!polys.length) return null;
  return { type: 'MultiPolygon', coordinates: polys.map(p => [p.outer, ...p.holes]) };
}

export function flattenRings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  return [];
}

export function beatsFromGeoJSON(gj, { prefix, place, codeField, labelOf }) {
  const set = new BeatSet(prefix, place, labelOf);
  for (const f of gj.features ?? []) {
    const props = f.properties ?? {};
    const code = props[codeField];
    set.add(code, flattenRings(f.geometry), labelOf ? labelOf(code, props) : undefined);
  }
  return set;
}

export function readDbf(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nrec = dv.getUint32(4, true), hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true);
  const fields = []; let pos = 32;
  while (pos < hlen && buf[pos] !== 0x0D) {
    let name = '';
    for (let i = 0; i < 11 && buf[pos + i]; i++) name += String.fromCharCode(buf[pos + i]);
    fields.push({ name, len: buf[pos + 16] }); pos += 32;
  }
  const rows = []; let off = hlen;
  for (let i = 0; i < nrec; i++) {
    const del = buf[off]; let p = off + 1; const row = {};
    for (const f of fields) { row[f.name] = Buffer.from(buf.buffer, buf.byteOffset + p, f.len).toString('latin1').trim(); p += f.len; }
    rows.push(del === 0x2A ? null : row); off += rlen;
  }
  return rows;
}

/** Polygon / PolygonZ / PolygonM records, one ring-list per shape (empty if null). */
export function readShpPolygons(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const polys = []; let o = 100;
  while (o + 8 <= buf.length) {
    const recBytes = dv.getInt32(o + 4, false) * 2;
    const content = o + 8;
    if (content + 4 > buf.length) break;
    const st = dv.getInt32(content, true);
    if (st === 5 || st === 15 || st === 25) {
      let p = content + 4 + 32;
      const numParts = dv.getInt32(p, true); p += 4;
      const numPoints = dv.getInt32(p, true); p += 4;
      const parts = [];
      for (let i = 0; i < numParts; i++) { parts.push(dv.getInt32(p, true)); p += 4; }
      parts.push(numPoints);
      const rings = [];
      for (let i = 0; i < numParts; i++) {
        const ring = [];
        for (let j = parts[i]; j < parts[i + 1]; j++) ring.push([dv.getFloat64(p + j * 16, true), dv.getFloat64(p + j * 16 + 8, true)]);
        if (ring.length >= 4) rings.push(ring);
      }
      polys.push(rings);
    } else polys.push([]);
    o = content + Math.max(recBytes, 4);
  }
  return polys;
}

export function beatsFromShapefile(shp, dbf, { prefix, place, codeField, labelOf }) {
  const shapes = readShpPolygons(shp), rows = readDbf(dbf);
  const set = new BeatSet(prefix, place, labelOf);
  const n = Math.min(shapes.length, rows.length);
  for (let i = 0; i < n; i++) if (rows[i] && shapes[i].length) set.add(rows[i][codeField], shapes[i], labelOf ? labelOf(rows[i][codeField], rows[i]) : undefined);
  return { set, shapes: shapes.length, rows: rows.length };
}

/** Extract a .tar or .tar.gz buffer into name -> Buffer. */
export function untar(buf) {
  const files = new Map(); let o = 0;
  while (o + 512 <= buf.length) {
    const name = buf.slice(o, o + 100).toString('utf8').replace(/\0.*/, '');
    if (!name) break;
    const size = parseInt(buf.slice(o + 124, o + 136).toString('utf8').replace(/\0.*/, '').trim() || '0', 8) || 0;
    const prefix = buf.slice(o + 345, o + 500).toString('utf8').replace(/\0.*/, '');
    o += 512;
    files.set(prefix ? prefix + '/' + name : name, buf.slice(o, o + size));
    o += Math.ceil(size / 512) * 512;
  }
  return files;
}
export const gunzip = gunzipSync;

export class HeatAgg {
  constructor() {
    this.units = new Map(); this.beats = []; this.byId = new Map(); this.spatial = null;
    this.years = new Set(); this.mapped = 0; this.unmapped = 0; this.bySrc = new Map();
  }
  addBeatSet(set) { for (const b of set.list) { this.beats.push(b); this.byId.set(b.id, b); } }
  finishIndex() { this.spatial = new Spatial(this.beats); }
  srcStats(src) { let s = this.bySrc.get(src); if (!s) { s = { seen: 0, mapped: 0, unmapped: 0 }; this.bySrc.set(src, s); } return s; }
  /** beatSet is the code dictionary for this source. Polygons from every loaded set are used for point-in-polygon. */
  add(fields, beatSet) {
    const stop = fields.year !== undefined && fields.cite !== undefined && fields.src !== undefined && Object.keys(fields).every(k => KNOWN.has(k)) ? fields : makeStop(fields);
    const st = this.srcStats(stop.src); st.seen++;
    if (!stop.year || stop.dow < 0 || stop.dow > 6 || stop.year < YEAR_BASE) { this.unmapped++; st.unmapped++; return; }
    this.years.add(stop.year);
    let beat = null;
    if (stop.beatId && beatSet) beat = beatSet.byCode.get(normCode(stop.beatId)) ?? null;
    const ll = validLL(stop.lat, stop.lng);
    // A publisher's coordinates must never fall back into another agency's beats.
    // With no source-owned beat set, keep verified coordinates in their grid cells.
    if (beat && ll && !pointInRings(stop.lng, stop.lat, beat.rings)) beat = null;
    if (!beat && ll && beatSet) {
      beatSet.spatial ??= new Spatial(beatSet.list);
      beat = beatSet.spatial.hit(stop.lng, stop.lat);
    }
    let unit;
    if (beat) {
      unit = this.units.get(beat.id);
      if (!unit) { unit = newUnit('beat', beat.id); this.units.set(beat.id, unit); }
    } else if (ll) {
      const s = snap(stop.lat, stop.lng);
      const lat = +s.lat.toFixed(5), lng = +s.lng.toFixed(5);
      const key = `g:${lat},${lng}`;
      unit = this.units.get(key);
      if (!unit) { unit = newUnit('grid', key, lat, lng); this.units.set(key, unit); }
    } else { this.unmapped++; st.unmapped++; return; }
    const tod = stop.hour == null ? 6 : Math.min(5, Math.max(0, Math.floor(stop.hour / 4)));
    const pack = packBucket(stop.year, tod, stop.dow);
    unit.n++; unit.b.set(pack, (unit.b.get(pack) ?? 0) + 1);
    if (stop.cite || stop.warn || stop.arrest) {
      const o = unit.o.get(pack) ?? [0, 0, 0];
      o[0] += stop.cite; o[1] += stop.warn; o[2] += stop.arrest; unit.o.set(pack, o);
    }
    if (stop.reason != null && stop.reason >= 0) {
      const rk = (stop.year - YEAR_BASE) * 16 + stop.reason;
      unit.r.set(rk, (unit.r.get(rk) ?? 0) + 1);
    }
    unit.src.set(stop.src, (unit.src.get(stop.src) ?? 0) + 1);
    this.mapped++; st.mapped++;
  }
}

function newUnit(kind, id, lat, lng) { return { kind, id, lat, lng, n: 0, b: new Map(), o: new Map(), r: new Map(), src: new Map() }; }

function flatPairs(map) { return [...map.entries()].sort((a, b) => a[0] - b[0]).flat(); }
function flatOutcomes(map) { return [...map.entries()].sort((a, b) => a[0] - b[0]).flatMap(([p, o]) => [p, o[0], o[1], o[2]]); }
function flatReasons(map) { return [...map.entries()].sort((a, b) => a[0] - b[0]).flatMap(([k, c]) => [Math.floor(k / 16), k % 16, c]); }
function flatSrc(map) { return [...map.entries()].sort((a, b) => a[0] - b[0]).flat(); }

export function serialize(agg, { tol = 0.0003 } = {}) {
  const tiles = new Map(); const beatFiles = new Map(); let beats = 0, cells = 0;
  for (const u of agg.units.values()) {
    const src = flatSrc(u.src), b = flatPairs(u.b), o = flatOutcomes(u.o), r = flatReasons(u.r);
    if (u.kind === 'grid') {
      cells++;
      const k = tileKey(u.lat, u.lng);
      let arr = tiles.get(k); if (!arr) { arr = []; tiles.set(k, arr); }
      arr.push([+u.lat.toFixed(5), +u.lng.toFixed(5), src, b, o, r]);
    } else {
      const geomBeat = agg.byId.get(u.id);
      if (!geomBeat) continue;
      const geometry = ringsToGeometry(geomBeat.rings, tol);
      if (!geometry) continue;
      beats++;
      const file = geomBeat.id.split(':')[0];
      let fc = beatFiles.get(file);
      if (!fc) { fc = { type: 'FeatureCollection', features: [] }; beatFiles.set(file, fc); }
      fc.features.push({ type: 'Feature', geometry, properties: { id: geomBeat.id, label: geomBeat.label, place: geomBeat.place, n: u.n, src, b, o, r } });
    }
  }
  return { tiles, beatFiles, beats, cells, years: [...agg.years].sort((a, b) => a - b) };
}

export function assertOutputClean(value, path = '') {
  if (value == null) return;
  if (Array.isArray(value)) { value.forEach((v, i) => assertOutputClean(v, `${path}[${i}]`)); return; }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (PII_KEY.test(k)) throw new Error(`refusing to write identifying key ${k} at ${path}`);
      assertOutputClean(v, path ? `${path}.${k}` : k);
    }
    return;
  }
  if (typeof value === 'string') {
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(value)) throw new Error('refusing SSN-like value at ' + path);
    const key = path.split('.').pop();
    if (value.length > 400 && !LONG_OK.has(key)) throw new Error('refusing long free-text value at ' + path);
  }
}
