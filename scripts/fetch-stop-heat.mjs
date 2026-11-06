#!/usr/bin/env node
// Builds the historical traffic-stop layer: public/data/stop-heat/.
// Downloads public files, keeps only date parts / coarse place / outcome / reason category,
// and writes beat choropleths or ~150 m grid counts. Raw rows are not written.
// Person columns (names, badge, address, DOB, license, officer id, race, sex, age) are never selected
// into the aggregate. A zip that still contains those columns is streamed in a temp dir and deleted.
//
// Usage:
//   node scripts/fetch-stop-heat.mjs
//   node scripts/fetch-stop-heat.mjs --only opp_chicago,urbana
//   node scripts/fetch-stop-heat.mjs --cache /tmp/stop-heat
//
// Sources that publish no coordinates and no beat polygon we can join are listed in the index
// under notMapped and are not downloaded. See docs/stop-heat.md.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DOW, GRID_M, REASONS, TILE_DEG, TOD, YEAR_BASE,
  assertOutputClean, beatsFromGeoJSON, beatsFromShapefile, classifyReason, flag,
  gunzip, makeStop, normCode, outcomesFrom, parseCSVLine, parseHour, partsFromDate, serialize, untar,
} from './stop-heat-lib.mjs';

const UA = { 'User-Agent': 'patrol-radar-stop-heat/1.0 (github.com/missionaryj/patrol-radar)' };
const DISCLAIMER = 'Official stop records can be months or years behind. A shaded area is a police beat or a 150 m cell, never one stop. Many places publish no mappable location, so coverage is uneven.';

/** Columns read from each file. Anything not listed is ignored, even if the download contains it. */
const COLS = {
  opp: ['date', 'time', 'lat', 'lng', 'beat', 'violation', 'outcome', 'citation_issued', 'warning_issued', 'arrest_made'],
  urbana: ['stop_date', 'stop_time', 'geo_code', 'citation_issued', 'arrest_made', 'reason_for_stop_drug', 'reason_for_stop_radio', 'reason_for_stop_fits', 'reason_for_stop_casing', 'reason_for_stop_proximity', 'reason_for_stop_gang', 'reason_for_stop_suspicious', 'reason_for_stop_other', 'georeference'],
  nypd: ['occur_dt', 'occur_tm', 'cmd_cd', 'summon_issued_flg', 'arrest_made_flg', 'latitude', 'longitude'],
  montgomery: ['date_of_stop', 'time_of_stop', 'latitude', 'longitude', 'violation_type', 'description'],
};

const NOT_MAPPED = [
  { id: 'opp_il_statewide', name: 'Stanford Open Policing Project — Illinois statewide', url: 'https://stacks.stanford.edu/file/druid:yg821jf8611/yg821jf8611_il_statewide_2020_04_01.csv.zip', why: 'About 12 million IDOT-style rows, mostly beat codes without coordinates. No statewide beat polygons are bundled here, so it is not drawn. Pass a beat GeoJSON into a future run if you have one; do not commit the raw file.' },
  { id: 'ct_stops', name: 'Connecticut traffic stops (data.ct.gov)', url: 'https://data.ct.gov/d/nahi-zqrt', why: 'Published rows have a town and an intersection string, not coordinates. Intersections are not geocoded (that would invent precise points). Town-wide shapes are not drawn.' },
  { id: 'sd_opp', name: 'Stanford Open Policing Project — San Diego', url: 'https://stacks.stanford.edu/file/druid:yg821jf8611/yg821jf8611_ca_san_diego_2020_04_01.csv.zip', why: 'The standardized file has a service-area code and no coordinates. The project shapefile is nine police divisions and does not use those codes, so it is not drawn.' },
  { id: 'sd_ripa', name: 'San Diego RIPA stops', url: 'https://data.sandiego.gov/datasets/police-ripa-stops/', why: 'Quarterly files include a beat name and a street block, not latitude/longitude. Block addresses are not geocoded and are not stored.' },
];

const arg = f => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };

async function getBuf(url) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(180_000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      last = new Error(`${url} HTTP ${r.status}`);
      if (r.status === 429 || r.status >= 500) { await wait(1000 * (i + 1) ** 2); continue; }
      throw last;
    } catch (e) {
      if (e === last) throw e;
      last = e;
      await wait(1000 * (i + 1) ** 2);
    }
  }
  throw last instanceof Error ? last : new Error(String(url) + ' failed');
}
async function getJSON(url) { return JSON.parse((await getBuf(url)).toString('utf8')); }
const wait = ms => new Promise(r => setTimeout(r, ms));

async function materialize(url, filename, workDir) {
  const dest = join(workDir, filename);
  if (existsSync(dest) && statSync(dest).size > 1000) { console.log('  cache', filename); return dest; }
  console.log('  download', filename);
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok && r.body) { await pipeline(Readable.fromWeb(r.body), createWriteStream(dest)); return dest; }
    if (r.status === 429 || r.status >= 500) { await wait(1000 * (i + 1) ** 2); continue; }
    throw new Error(`${url} HTTP ${r.status}`);
  }
  throw new Error(url + ' failed');
}

async function forEachZipCsv(zipPath, fn) {
  const child = spawn('unzip', ['-p', zipPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = ''; child.stderr.on('data', d => { err += d; });
  const rl = readline.createInterface({ input: child.stdout });
  let idx = null, rows = 0;
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code ? reject(new Error(`unzip exit ${code}: ${err.slice(0, 180)}`)) : resolve());
  });
  for await (const line of rl) {
    if (!line) continue;
    if (!idx) { idx = Object.fromEntries(parseCSVLine(line).map((h, i) => [h.replace(/^\uFEFF/, ''), i])); continue; }
    fn(parseCSVLine(line), idx); rows++;
    if (rows % 250000 === 0) console.log(`  ${rows.toLocaleString()} rows`);
  }
  await done;
  return rows;
}

/** At most this many SODA calls in flight, shared by every city so two sources don't stampede. */
function sodaPool(n) {
  let active = 0; const q = [];
  const kick = () => { while (active < n && q.length) { const job = q.shift(); active++; Promise.resolve().then(job.fn).then(job.ok, job.bad).finally(() => { active--; kick(); }); } };
  return fn => new Promise((ok, bad) => { q.push({ fn, ok, bad }); kick(); });
}
const limitSoda = sodaPool(8);
async function sodaCsvPage(base, select, where, limit, offset) {
  return limitSoda(async () => {
    const u = new URL(base);
    u.searchParams.set('$select', select);
    u.searchParams.set('$limit', String(limit));
    u.searchParams.set('$offset', String(offset));
    if (where) u.searchParams.set('$where', where);
    const text = (await getBuf(u)).toString('utf8');
    const lines = text.split(/\r?\n/).filter(l => l.length);
    if (lines.length <= 1) return 0;
    return { lines, n: lines.length - 1 };
  });
}
/** Probe each year with one row, then fetch that year's months in parallel. Only `select` columns are parsed. */
async function forEachSodaWindow(base, select, dateCol, fn) {
  const limit = 20000; let total = 0;
  const pad = n => String(n).padStart(2, '0');
  const span = (a, b) => `${dateCol} >= '${a}' AND ${dateCol} < '${b}'`;
  const take = lines => {
    const idx = Object.fromEntries(parseCSVLine(lines[0]).map((h, i) => [h.replace(/^\uFEFF/, ''), i]));
    for (let i = 1; i < lines.length; i++) fn(parseCSVLine(lines[i]), idx);
    total += lines.length - 1;
  };
  const years = (await Promise.all(Array.from({ length: 2026 - 2008 + 1 }, (_, i) => 2008 + i).map(async y => {
    const probe = await sodaCsvPage(base, select, span(`${y}-01-01T00:00:00.000`, `${y + 1}-01-01T00:00:00.000`), 1, 0);
    return probe && probe.n ? y : 0;
  }))).filter(Boolean);
  console.log(`  years ${years.join(',') || '(none)'}`);
  await Promise.all(years.flatMap(y => Array.from({ length: 12 }, (_, i) => i + 1).map(async m => {
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    const where = span(`${y}-${pad(m)}-01T00:00:00.000`, `${ny}-${pad(nm)}-01T00:00:00.000`);
    let offset = 0, got = 0;
    for (;;) {
      const page = await sodaCsvPage(base, select, where, limit, offset);
      if (!page || page.n === 0) break;
      take(page.lines); got += page.n; offset += page.n;
      if (page.n < limit) break;
    }
    if (got) console.log(`  ${y}-${pad(m)} +${got.toLocaleString()} (${total.toLocaleString()})`);
  })));
  console.log(`  ${total.toLocaleString()} rows`);
  return total;
}

async function forEachSodaJson(base, select, fn) {
  const limit = 5000;
  for (let offset = 0; ; offset += limit) {
    const u = new URL(base);
    u.searchParams.set('$select', select);
    u.searchParams.set('$limit', String(limit));
    u.searchParams.set('$offset', String(offset));
    const rows = await getJSON(u);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) fn(row);
    console.log(`  ${(offset + rows.length).toLocaleString()} rows`);
    if (rows.length < limit) break;
  }
}

const cell = (cols, idx, name) => { const i = idx[name]; return i == null ? '' : cols[i] ?? ''; };
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

function addDated(agg, src, beatSet, parts, hour, extra) {
  if (!parts) return;
  agg.add(makeStop({ year: parts.year, dow: parts.dow, hour, src, ...extra }), beatSet);
}

async function metaDate(url) {
  try {
    const j = await getJSON(url);
    const t = j.rowsUpdatedAt ? new Date(j.rowsUpdatedAt * 1000) : j.modified ? new Date(j.modified) : null;
    return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : null;
  } catch { return null; }
}

async function loadChicagoBeats(workDir) {
  const tgz = await materialize('https://stacks.stanford.edu/file/druid:wb225bk3255/wb225bk3255_il_chicago_shapefiles_2023_01_26.tgz', 'chicago-shapes.tgz', workDir);
  const files = untar(gunzip(readFileSync(tgz)));
  const shp = [...files.keys()].find(k => k.endsWith('beats.shp'));
  const dbf = [...files.keys()].find(k => k.endsWith('beats.dbf'));
  if (!shp || !dbf) throw new Error('Chicago beat shapefile missing');
  const { set } = beatsFromShapefile(files.get(shp), files.get(dbf), {
    prefix: 'chicago', place: 'Chicago, IL', codeField: 'beat_num', labelOf: c => 'Beat ' + String(c).trim(),
  });
  console.log(`  chicago beats: ${set.list.length}`);
  return set;
}

async function loadNycBeats() {
  const gj = await getJSON('https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_Police_Precincts/FeatureServer/0/query?where=1%3D1&outFields=Precinct&returnGeometry=true&outSR=4326&f=geojson');
  const set = beatsFromGeoJSON(gj, { prefix: 'nyc', place: 'New York, NY', codeField: 'Precinct', labelOf: c => 'Precinct ' + normCode(c) });
  console.log(`  nyc precincts: ${set.list.length}`);
  return set;
}

async function loadChampaignBeats() {
  const gj = await getJSON('https://gisportal.champaignil.gov/ms/rest/services/Open_Data/Open_Data/MapServer/25/query?where=1%3D1&outFields=NAME&outSR=4326&f=geojson');
  const set = beatsFromGeoJSON(gj, { prefix: 'champaign', place: 'Champaign, IL', codeField: 'NAME', labelOf: c => 'Beat ' + String(c).trim() });
  console.log(`  champaign beats: ${set.list.length}`);
  return set;
}

async function ingestChicago(agg, src, beatSet, workDir) {
  const zip = await materialize('https://stacks.stanford.edu/file/druid:wb225bk3255/wb225bk3255_il_chicago_2023_01_26.csv.zip', 'chicago.zip', workDir);
  let coded = 0, codeMiss = 0;
  await forEachZipCsv(zip, (cols, idx) => {
    const parts = partsFromDate(cell(cols, idx, 'date'));
    const beatId = cell(cols, idx, 'beat');
    const code = normCode(beatId);
    if (code) { coded++; if (!beatSet.byCode.has(code)) codeMiss++; }
    const oc = outcomesFrom({ outcome: cell(cols, idx, 'outcome'), citation_issued: cell(cols, idx, 'citation_issued'), warning_issued: cell(cols, idx, 'warning_issued'), arrest_made: cell(cols, idx, 'arrest_made') });
    addDated(agg, src, beatSet, parts, parseHour(cell(cols, idx, 'time')), {
      lat: num(cell(cols, idx, 'lat')), lng: num(cell(cols, idx, 'lng')), beatId, reason: classifyReason(cell(cols, idx, 'violation')), ...oc,
    });
  });
  console.log(`  beat codes ${coded.toLocaleString()}, unmatched codes ${codeMiss.toLocaleString()}`);
}

async function ingestUrbana(agg, src, beatSet) {
  const investigatory = ['reason_for_stop_drug', 'reason_for_stop_radio', 'reason_for_stop_fits', 'reason_for_stop_casing', 'reason_for_stop_proximity', 'reason_for_stop_gang', 'reason_for_stop_suspicious'];
  await forEachSodaJson('https://data.illinois.gov/resource/vnxf-tjw4.json', COLS.urbana.join(','), row => {
    const parts = partsFromDate(row.stop_date);
    const coords = row.georeference?.coordinates;
    const reason = investigatory.some(k => flag(row[k])) ? classifyReason('suspicious') : classifyReason(row.reason_for_stop_other);
    // geo_code is kept only as a beat id. The address and the raw point are not passed on.
    addDated(agg, src, beatSet, parts, parseHour(row.stop_time), {
      lat: num(coords?.[1]), lng: num(coords?.[0]), beatId: row.geo_code, reason,
      cite: flag(row.citation_issued) ? 1 : 0, warn: 0, arrest: flag(row.arrest_made) ? 1 : 0,
    });
  });
}

async function ingestNypd(agg, src, beatSet) {
  await forEachSodaWindow('https://data.cityofnewyork.us/resource/hn9i-dwpr.csv', COLS.nypd.join(','), 'occur_dt', (cols, idx) => {
    const parts = partsFromDate(cell(cols, idx, 'occur_dt'));
    const oc = outcomesFrom({ summon_issued_flg: cell(cols, idx, 'summon_issued_flg'), arrest_made_flg: cell(cols, idx, 'arrest_made_flg') });
    addDated(agg, src, beatSet, parts, parseHour(cell(cols, idx, 'occur_tm')), {
      lat: num(cell(cols, idx, 'latitude')), lng: num(cell(cols, idx, 'longitude')), beatId: cell(cols, idx, 'cmd_cd'), reason: null, ...oc,
    });
  });
}

async function ingestMontgomery(agg, src) {
  await forEachSodaWindow('https://data.montgomerycountymd.gov/resource/4mse-ku6q.csv', COLS.montgomery.join(','), 'date_of_stop', (cols, idx) => {
    const parts = partsFromDate(cell(cols, idx, 'date_of_stop'));
    const oc = outcomesFrom({ violation_type: cell(cols, idx, 'violation_type') });
    addDated(agg, src, null, parts, parseHour(cell(cols, idx, 'time_of_stop')), {
      lat: num(cell(cols, idx, 'latitude')), lng: num(cell(cols, idx, 'longitude')), beatId: '', reason: classifyReason(cell(cols, idx, 'description')), ...oc,
    });
  });
}

function sourceRow(meta, stats, last) {
  const s = stats ?? { seen: 0, mapped: 0, unmapped: 0 };
  return { id: meta.id, name: meta.name, url: meta.url, license: meta.license, last_updated: last, fetched: new Date().toISOString().slice(0, 10), stops: s.seen, mapped: s.mapped, unmapped: s.unmapped, note: meta.note };
}

const PIPELINE = [
  { id: 'opp_chicago', name: 'Stanford Open Policing Project — Chicago', url: 'https://openpolicing.stanford.edu/data/', license: 'Open Data Commons Attribution License (ODC-BY 1.0)', note: 'Standardized stops, roughly 2012–2016 and 2018–2020. Beat outlines are the project shapefile (ODC-BY). A row with no beat code is placed in the beat polygon that contains its published coordinate, or on the 150 m grid if it falls outside.', published: '2023-02-01' },
  { id: 'urbana', name: 'City of Urbana IDOT stop sheets', url: 'https://data.illinois.gov/Local-Government/City-Of-Urbana-IDOT-Stop-Sheet-Police-Data-/vnxf-tjw4', license: 'City of Urbana open data, via data.illinois.gov', note: 'Stop-sheet rows with a published map point. Points are snapped to the 150 m grid unless they fall inside a Champaign beat polygon. Street addresses are not stored. Geo codes that are not Champaign beat names are not drawn as beats.', meta: 'https://data.illinois.gov/api/views/vnxf-tjw4.json' },
  { id: 'nypd', name: 'NYPD Vehicle Stop Reports', url: 'https://data.cityofnewyork.us/d/hn9i-dwpr', license: 'NYC Open Data (City of New York)', note: 'Vehicle stops joined to NYPD precinct polygons on the published command code. The coordinate is not stored.', meta: 'https://data.cityofnewyork.us/api/views/hn9i-dwpr.json' },
  { id: 'montgomery', name: 'Montgomery County, MD electronic traffic violations', url: 'https://data.montgomerycountymd.gov/Public-Safety/Traffic-Violations/4mse-ku6q', license: 'dataMontgomery open data (Montgomery County, MD)', note: 'Geocoded electronic violations, snapped to the 150 m grid. Person and vehicle fields are not requested and not stored.', meta: 'https://data.montgomerycountymd.gov/api/views/4mse-ku6q.json' },
];

export async function buildStopHeat({ workDir, only, outDir = 'public/data/stop-heat' } = {}) {
  const { HeatAgg } = await import('./stop-heat-lib.mjs');
  const agg = new HeatAgg();
  const want = only ? new Set(only) : null;
  const run = id => !want || want.has(id);
  console.log('loading beat polygons');
  const tryLoad = async (label, fn) => { try { return await fn(); } catch (e) { console.warn(`  ${label} polygons failed: ${e.message}`); return null; } };
  const [chicago, nyc, champaign] = await Promise.all([
    run('opp_chicago') ? tryLoad('chicago', () => loadChicagoBeats(workDir)) : null,
    run('nypd') ? tryLoad('nyc', () => loadNycBeats()) : null,
    run('urbana') || run('opp_chicago') ? tryLoad('champaign', () => loadChampaignBeats()) : null,
  ]);
  if (chicago) agg.addBeatSet(chicago);
  if (nyc) agg.addBeatSet(nyc);
  if (champaign) agg.addBeatSet(champaign);
  agg.finishIndex();
  const sources = [];
  const indexOf = { opp_chicago: 0, urbana: 1, nypd: 2, montgomery: 3 };
  const jobs = {
    opp_chicago: () => ingestChicago(agg, 0, chicago, workDir),
    urbana: () => ingestUrbana(agg, 1, champaign),
    nypd: () => ingestNypd(agg, 2, nyc),
    montgomery: () => ingestMontgomery(agg, 3),
  };
  // Network sources start first. Chicago re-reads the cached zip (not a new download) and must not block those requests from being sent.
  const running = PIPELINE.filter(meta => run(meta.id));
  const remote = running.filter(meta => meta.id !== 'opp_chicago').map(meta => runJob(meta));
  await new Promise(r => setImmediate(r));
  const local = running.filter(meta => meta.id === 'opp_chicago').map(meta => runJob(meta));
  sources.push(...(await Promise.all([...remote, ...local])).filter(Boolean));
  sources.sort((a, b) => indexOf[a.id] - indexOf[b.id]);
  async function runJob(meta) {
    console.log('start', meta.id);
    let error = null;
    try { await jobs[meta.id](); }
    catch (e) { error = e; console.warn(`  FAILED ${meta.id}: ${e.message}`); }
    const last = meta.published ?? (meta.meta ? await metaDate(meta.meta) : null);
    const row = sourceRow(meta, agg.bySrc.get(indexOf[meta.id]), last);
    if (error) row.note = `${meta.note} Fetch failed: ${error.message}`;
    return row;
  }
  // Re-number to the compact index actually written, and remap unit source ids.
  const idToOut = new Map(sources.map((s, i) => [indexOf[s.id], i]));
  for (const u of agg.units.values()) {
    const nextSrc = new Map();
    for (const [src, n] of u.src) if (idToOut.has(src)) nextSrc.set(idToOut.get(src), (nextSrc.get(idToOut.get(src)) ?? 0) + n);
    u.src = nextSrc;
  }
  const built = serialize(agg, { tol: 0.00035 });
  const index = {
    generated: new Date().toISOString(),
    gridM: GRID_M,
    tileDeg: TILE_DEG,
    yearBase: YEAR_BASE,
    years: built.years,
    tod: TOD,
    dow: DOW,
    reasons: REASONS,
    disclaimer: DISCLAIMER,
    attribution: 'Stanford Open Policing Project (Open Data Commons Attribution License); City of Urbana open data; NYPD Vehicle Stop Reports (NYC Open Data); Montgomery County electronic traffic violations (dataMontgomery); Champaign, IL police-beat polygons (City of Champaign open data).',
    sources,
    notMapped: NOT_MAPPED,
    tiles: Object.fromEntries([...built.tiles.entries()].map(([k, v]) => [k, v.length])),
    beatFiles: [...built.beatFiles.keys()].sort().map(k => `beats/${k}.json`),
    totals: { stops: [...agg.bySrc.values()].reduce((a, s) => a + s.seen, 0), mapped: agg.mapped, unmapped: agg.unmapped, beats: built.beats, cells: built.cells },
    // Extension point: a later subscription may hide this layer. The file itself stays public and ungated.
    subscription: 'not-gated',
  };
  assertOutputClean(index);
  for (const [, fc] of built.beatFiles) assertOutputClean(fc);
  for (const [, rows] of built.tiles) assertOutputClean(rows);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'beats'), { recursive: true });
  mkdirSync(join(outDir, 'tiles'), { recursive: true });
  for (const [k, rows] of built.tiles) writeFileSync(join(outDir, 'tiles', `${k}.json`), JSON.stringify(rows));
  for (const [k, fc] of built.beatFiles) writeFileSync(join(outDir, 'beats', `${k}.json`), JSON.stringify(fc));
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
  console.log(JSON.stringify(index.totals));
  return index;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const cache = arg('--cache');
  const workDir = cache ?? join(tmpdir(), `patrol-radar-stop-heat-${process.pid}`);
  mkdirSync(workDir, { recursive: true });
  const only = arg('--only')?.split(',').filter(Boolean);
  try {
    await buildStopHeat({ workDir, only, outDir: arg('--out') ?? 'public/data/stop-heat' });
  } finally {
    if (!cache) rmSync(workDir, { recursive: true, force: true });
  }
}
