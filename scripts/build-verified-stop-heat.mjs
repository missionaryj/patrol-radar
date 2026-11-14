#!/usr/bin/env node
// Offline replayable, fail-closed build. Nothing is uploaded or deployed.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import { SOURCES, QUARANTINED, sourceURL, boundaryURL } from './stop-heat-sources.mjs';
import { StopValidator, jurisdictionContains, occupiedArea } from './stop-heat-validation.mjs';
import { HeatAgg, makeStop, outcomesFrom, classifyReason, parseHour, serialize, assertOutputClean, cityBeat, GRID_M, TILE_DEG, YEAR_BASE, TOD, DOW, REASONS } from './stop-heat-lib.mjs';
import { chicagoEncounterKey, urbanaLocationCode, urbanaReason } from './stop-heat-identity.mjs';
const UA = { 'User-Agent': 'PatrolRadar historical stop research (github.com/missionaryj/patrol-radar)' };
const digest = b => createHash('sha256').update(b).digest('hex');
const licenseNotices = JSON.parse(readFileSync(new URL('../docs/stop-heat-license-notices.json', import.meta.url), 'utf8'));
async function get(url) {
    let last;
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(180000) });
            if (r.ok)
                return r;
            if (r.status !== 429 && r.status < 500)
                throw Error(`Source HTTP ${r.status}`);
            last = Error(`Source HTTP ${r.status}`);
        }
        catch (e) {
            if (e instanceof Error && e.message.startsWith('Source HTTP'))
                throw e;
            last = e;
        }
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    }
    throw last instanceof Error ? last : Error('Source retries exhausted');
}
async function json(url) { const j = await (await get(url)).json(); if (j.error)
    throw Error('Source API error'); return j; }
async function cachedJSON(url, path, offline) {
    if (!existsSync(path)) {
        if (offline)
            throw Error('Missing offline boundary');
        const j = await json(url);
        writeFileSync(path, JSON.stringify(j));
    }
    const bytes = readFileSync(path);
    return { value: JSON.parse(bytes), sha256: digest(bytes), url };
}
export async function rows(stream, consume) {
    const allowed = new Set(['raw_row_number', 'date', 'time', 'type', 'lat', 'lng', 'beat', 'violation', 'outcome', 'citation_issued', 'warning_issued', 'arrest_made', 'reportnumber', 'eventdate', 'subjectrole', 'lat_x', 'lon_x', 'reasonsforstop', 'primaryactiontaken', 'evnt_key', 'occur_dt', 'occur_tm', 'summon_issued_flg', 'arrest_made_flg', 'latitude', 'longitude', 'seq_id', 'date_of_stop', 'time_of_stop', 'vehicle_type', 'violation_type', 'description', 'date_of_contact', 'time_of_contact', 'incident_number', 'geo_code', 'reason_for_stop', 'type_of_violation']);
    const parser = stream.pipe(parse({ columns: headers => headers.map(h => allowed.has(h) ? h : false), bom: true, skip_empty_lines: true }));
    stream.on('error', e => parser.destroy(e));
    // Never log raw rows, keys, dates of birth or source address text.
    try {
        for await (const row of parser)
            consume(row);
    }
    catch {
        throw Error('Source CSV or row validation failed; raw values suppressed');
    }
}
async function archive(s, cache, consume, offline) {
    const path = join(cache, s.id + '.zip');
    if (!existsSync(path)) {
        if (offline)
            throw Error('Missing offline archive');
        const temp = path + '.partial';
        await pipeline(Readable.fromWeb((await get(s.archive)).body), createWriteStream(temp));
        renameSync(temp, path);
    }
    if (digest(readFileSync(path)) !== s.sha256)
        throw Error('Archive checksum mismatch');
    // bsdtar is built into Windows; Linux/macOS use unzip. No shell interpolation.
    const windows = process.platform === 'win32';
    const child = spawn(windows ? 'tar' : 'unzip', windows ? ['-xOf', path] : ['-p', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', b => { stderr += b.toString().slice(0, 200); });
    const done = new Promise((ok, bad) => { child.on('error', bad); child.on('close', code => code ? bad(Error('Archive extraction failed')) : ok()); });
    try {
        await Promise.all([rows(child.stdout, consume), done]);
    }
    catch (e) {
        child.kill();
        throw e;
    }
    return { url: s.archive, sha256: s.sha256, snapshot: 'pinned archive' };
}
async function soda(s, cache, consume, offline) {
    const receiptPath = join(cache, s.id + '-receipt.json');
    const base = `https://${s.domain}/resource/${s.dataset}.json`;
    const metaURL = `https://${s.domain}/api/views/${s.dataset}.json`;
    let receipt;
    if (offline)
        receipt = JSON.parse(readFileSync(receiptPath));
    else {
        const meta = await json(metaURL);
        const count = await json(base + '?' + new URLSearchParams({ '$select': 'count(*)' }));
        receipt = { url: base, selection: s.select, rowsUpdatedAt: meta.rowsUpdatedAt, expected_rows: Number(count[0].count), fetched: new Date().toISOString(), pages: [], license: meta.license ?? null };
        if (!Number.isSafeInteger(receipt.expected_rows) || receipt.expected_rows < 1 || !receipt.rowsUpdatedAt)
            throw Error('Invalid source snapshot');
    }
    if (receipt.selection !== s.select)
        throw Error('Cached source projection differs; acquire a fresh snapshot');
    const size = 50000;
    if (!offline) {
        // Bounded parallel downloads, followed by deterministic in-order parsing.
        // The publisher revision and count are checked again before publication.
        let next = 0;
        await Promise.all(Array.from({ length: 4 }, async () => {
            for (;;) {
                const offset = next;
                next += size;
                if (offset >= receipt.expected_rows)
                    return;
                const path = join(cache, `${s.id}-${offset}.csv`);
                if (!existsSync(path)) {
                    const u = new URL(`https://${s.domain}/resource/${s.dataset}.csv`);
                    u.search = new URLSearchParams({ '$select': s.select, '$order': ':id', '$limit': String(size), '$offset': String(offset) });
                    const temp = path + '.partial';
                    let saved = false, last;
                    for (let attempt = 0; attempt < 6 && !saved; attempt++) {
                        try {
                            await pipeline(Readable.fromWeb((await get(u)).body), createWriteStream(temp));
                            renameSync(temp, path);
                            saved = true;
                        }
                        catch (e) {
                            last = e;
                            await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
                        }
                    }
                    if (!saved)
                        throw last instanceof Error ? last : Error('Source page download failed');
                }
                receipt.pages.push({ offset, sha256: digest(readFileSync(path)) });
                console.log(`  downloaded ${s.id} page ${offset / size + 1}`);
            }
        }));
        receipt.pages.sort((a, b) => a.offset - b.offset);
    }
    for (let offset = 0; offset < receipt.expected_rows; offset += size) {
        const path = join(cache, `${s.id}-${offset}.csv`);
        const page = receipt.pages.find(p => p.offset === offset);
        if (!page || page.sha256 !== digest(readFileSync(path)))
            throw Error('Page checksum mismatch');
        let n = 0;
        await rows(createReadStream(path), row => { n++; consume(row); });
        if (n !== Math.min(size, receipt.expected_rows - offset))
            throw Error('Incomplete source page');
        console.log(`  ${s.id}: ${offset + n} source rows`);
    }
    if (!offline) {
        const after = await json(metaURL);
        const count = await json(base + '?' + new URLSearchParams({ '$select': 'count(*)' }));
        if (after.rowsUpdatedAt !== receipt.rowsUpdatedAt || Number(count[0].count) !== receipt.expected_rows)
            throw Error('Source changed during fetch; rerun from a consistent snapshot');
        writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    }
    return { ...receipt, sha256: digest(JSON.stringify(receipt.pages)) };
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
export function normalize(s, r) {
    if (s.id === 'urbana_ivc') {
        const datetime = String(r.date_of_contact ?? '');
        const date = ISO_DATE.test(datetime) ? datetime.slice(0, 10) : '';
        const time = String(r.time_of_contact ?? '').trim();
        // This collection is the vehicle traffic-stop table. No coordinate is invented from geo_code.
        return { key: String(r.incident_number ?? '').trim(), vehicle: true, date, time, hour: parseHour(time), lat: null, lng: null,
            locationCode: urbanaLocationCode(r.geo_code), reason: urbanaReason(r.reason_for_stop, r.type_of_violation), cite: 0, warn: 0, arrest: 0 };
    }
    const opp = Boolean(s.archive);
    const datetime = r.eventdate ?? r.occur_dt ?? r.date_of_stop ?? r.date ?? '';
    const validDate = ISO_DATE.test(datetime);
    const date = validDate ? datetime.slice(0, 10) : '', time = r.time ?? r.occur_tm ?? r.time_of_stop ?? datetime.slice(11, 19);
    // Chicago does not use raw_row_number: that id is unique per extract row and hides duplicate joins.
    let key = s.id === 'opp_chicago' ? chicagoEncounterKey(r) : r.raw_row_number ?? r.reportnumber ?? r.evnt_key ?? r.seq_id;
    const vehicle = opp ? r.type === 'vehicular' : s.id === 'cincinnati' ? String(r.subjectrole ?? '').split(';').map(x => x.trim()).includes('Driver') : s.id === 'montgomery' ? /^(?:0[1-9]|1\d|2[0-7]) - /.test(r.vehicle_type ?? '') : true;
    const o = outcomesFrom({ ...r, outcome: r.primaryactiontaken ?? r.outcome });
    return { key, vehicle, date, time, hour: parseHour(time), lat: r.lat ?? r.lat_x ?? r.latitude, lng: r.lng ?? r.lon_x ?? r.longitude,
        reason: classifyReason(r.violation ?? r.reasonsforstop ?? r.description), ...o };
}
export async function build({ cache, out, offline = false, asOf = new Date().toISOString().slice(0, 10), only } = {}) {
    if (!cache || !out)
        throw Error('--cache and --out are required');
    const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const cachePath = resolve(cache), outPath = resolve(out);
    const within = (parent, child) => { const r = relative(parent, child); return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r)); };
    if (within(repo, cachePath) || within(outPath, cachePath) || within(cachePath, outPath))
        throw Error('Cache must be outside the checkout and output tree; raw archives may contain personal fields');
    if (within(outPath, repo))
        throw Error('Output cannot replace the checkout or its ancestors');
    mkdirSync(cache, { recursive: true });
    const selected = only ? SOURCES.filter(s => only.includes(s.id)) : SOURCES;
    if (!selected.length || (only && only.some(id => !SOURCES.some(s => s.id === id))))
        throw Error('Unknown/empty source selection');
    const agg = new HeatAgg(), sources = [], boundaries = [], cells = new Map(), jurisdictions = [];
    for (const [src, s] of selected.entries()) {
        console.log('validate', s.id);
        const boundary = await cachedJSON(boundaryURL(s), join(cache, s.geo + '-boundary.json'), offline);
        if (boundary.value.features?.length !== 1 || boundary.value.features[0].properties.GEOID !== s.geo)
            throw Error('Unexpected Census boundary');
        const f = boundary.value.features[0];
        if (Number(f.properties.POP100) !== s.population)
            throw Error('Census population mismatch');
        const city = s.geography === 'city';
        const validator = new StopValidator({ contains: jurisdictionContains(f.geometry), start: s.start, end: s.end, asOf, placement: city ? 'city' : 'point' });
        const consume = r => validator.add(normalize(s, r));
        const receipt = await (s.archive ? archive(s, cache, consume, offline) : soda(s, cache, consume, offline));
        const report = validator.report();
        if (!report.accepted) {
            console.log(s.id, JSON.stringify(report));
            throw Error('Empty accepted source');
        }
        if (city) {
            const set = cityBeat(f.geometry, { prefix: s.id, place: f.properties.NAME, label: s.cityLabel });
            agg.addBeatSet(set);
            for (const r of validator.events.values())
                agg.add(makeStop({ year: r.year, dow: r.dow, hour: r.hour, lat: null, lng: null, beatId: 'city', cite: r.cite, warn: r.warn, arrest: r.arrest, reason: r.reason, src }), set);
            if (validator.cells.size)
                throw Error('Citywide counts must not invent grid cells');
        } else {
            for (const r of validator.events.values())
                agg.add(makeStop({ year: r.year, dow: r.dow, hour: r.hour, lat: r.lat, lng: r.lng, cite: r.cite, warn: r.warn, arrest: r.arrest, reason: r.reason, src }));
            for (const [key, value] of validator.cells)
                cells.set(key, value);
        }
        boundaries.push(f.geometry);
        jurisdictions.push({ geoid: s.geo, name: f.properties.NAME, state: s.state, population_2020: s.population, land_m2: Number(f.properties.AREALAND), water_m2: Number(f.properties.AREAWATER), boundary: { url: boundary.url, sha256: boundary.sha256 } });
        sources.push({ id: s.id, name: s.name, url: sourceURL(s), license: s.license, last_updated: s.archive ? null : new Date(receipt.rowsUpdatedAt * 1000).toISOString().slice(0, 10), fetched: receipt.fetched?.slice(0, 10) ?? asOf,
            stops: report.accepted, mapped: report.accepted, unmapped: report.rejected, note: s.note,
            precision: city ? '2020 Census city boundary; agency geocodes are not drawn and no 150 m cells are created' : s.id === 'nypd' ? 'publisher anonymized coordinates' : 'publisher coordinates; accuracy unverified',
            identity: s.id === 'opp_chicago' ? 'identical public stop attributes; residual duplicates possible' : city ? 'publisher incident number; conflicting copies quarantined' : s.archive ? 'publisher row; encounter uniqueness not independently verified' : 'publisher event identifier',
            audit: report, download: { ...receipt, pages: receipt.pages }, boundary: jurisdictions.at(-1).boundary,
            disclaimer: licenseNotices[s.id]?.text, license_url: licenseNotices[s.id]?.url, license_notice_sha256: licenseNotices[s.id]?.sha256 });
        console.log(s.id, JSON.stringify(report));
    }
    // US denominator is all 50 states plus DC, excluding territories. State and
    // local agency presence never implies complete population or land coverage.
    const census = 'https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/tigerWMS_Census2020/MapServer/80/query?where=1%3D1&outFields=GEOID,NAME,POP100,AREALAND,AREAWATER&returnGeometry=false&f=json';
    const national = await cachedJSON(census, join(cache, 'us-2020.json'), offline);
    const states = national.value.features.filter(f => Number(f.attributes.GEOID) <= 56 && !['60', '66', '69', '72', '78'].includes(f.attributes.GEOID));
    if (states.length !== 51)
        throw Error('US denominator must contain 50 states plus DC');
    const population = states.reduce((a, f) => a + Number(f.attributes.POP100), 0);
    const area = states.reduce((a, f) => a + Number(f.attributes.AREALAND) + Number(f.attributes.AREAWATER), 0);
    const footprint = occupiedArea(cells, boundaries);
    const coverage = { states_with_records: [...new Set(selected.map(s => s.state))].sort(), state_count: new Set(selected.map(s => s.state)).size, state_denominator: 51,
        jurisdictions, population_of_jurisdictions: jurisdictions.reduce((a, j) => a + j.population_2020, 0), us_population_2020: population,
        occupied_grid_cells: cells.size, occupied_cell_footprint_m2: footprint, us_total_area_m2: area, occupied_cell_us_area_percent: 100 * footprint / area,
        point_area_m2: 0, denominator: { url: census, sha256: national.sha256 },
        note: 'Jurisdiction population is agency footprint context, not residents covered by stop observations. Occupied 150 m cells clipped to 2020 Census jurisdiction polygons measure a coarse observation footprint (including water), not road coverage or complete state coverage. Points themselves have zero area. A citywide boundary shade is not an occupied-cell footprint and is not added here. Source positional accuracy is not independently verified. No 75% coverage claim.' };
    if (agg.unmapped || agg.mapped !== sources.reduce((n, s) => n + s.audit.accepted, 0))
        throw Error('Accepted records did not reconcile to aggregate counts');
    const built = serialize(agg);
    let serialized = 0;
    for (const rows of built.tiles.values())
        for (const cell of rows)
            for (let i = 1; i < cell[3].length; i += 2)
                serialized += cell[3][i];
    for (const fc of built.beatFiles.values())
        for (const feat of fc.features)
            for (let i = 1; i < feat.properties.b.length; i += 2)
                serialized += feat.properties.b[i];
    if (serialized !== agg.mapped)
        throw Error('Serialized counts did not reconcile');
    const index = { generated: new Date().toISOString(), gridM: GRID_M, tileDeg: TILE_DEG, yearBase: YEAR_BASE, years: built.years, tod: TOD, dow: DOW, reasons: REASONS,
        disclaimer: 'Historical records only; coverage is uneven and regional. Coordinates are publisher supplied, sometimes anonymized. Chicago collapses identical public stop rows and can still contain duplicate encounters. Urbana is a citywide total: the stops are not located inside the city on this map. Counts use event IDs where available. Shading is visual only, not current police activity or a prediction.',
        attribution: 'Stanford Open Policing Project (ODC-BY), including Chicago vehicle stops; Cincinnati Police open data; NYPD Vehicle Stop Reports; dataMontgomery; City of Urbana stop-level traffic stops via data.illinois.gov; U.S. Census Bureau 2020 geography and population.',
        sources, notMapped: QUARANTINED, coverage, tiles: Object.fromEntries([...built.tiles].map(([k, v]) => [k, v.length])), beatFiles: [...built.beatFiles.keys()].sort().map(k => `beats/${k}.json`),
        totals: { stops: agg.mapped, mapped: agg.mapped, unmapped: sources.reduce((a, s) => a + s.audit.rejected, 0), beats: built.beats, cells: built.cells },
        counting_note: 'Accepted source stop records, not a verified count of unique encounters across all publishers. Chicago deduplicates identical public attributes only. Urbana counts are incident numbers shaded on the city boundary, not 150 m cells.', subscription: 'not-gated' };
    assertOutputClean(index);
    for (const rows of built.tiles.values())
        assertOutputClean(rows);
    for (const fc of built.beatFiles.values())
        assertOutputClean(fc);
    const target = resolve(out), stage = target + '.staging';
    // No recursive deletion. A failed build leaves the existing output untouched.
    if (existsSync(stage) || existsSync(target + '.previous'))
        throw Error('Staging/backup already exists; choose a new output path');
    mkdirSync(join(stage, 'tiles'), { recursive: true });
    mkdirSync(join(stage, 'beats'));
    for (const [key, rows] of built.tiles)
        writeFileSync(join(stage, 'tiles', key + '.json'), JSON.stringify(rows));
    for (const [key, fc] of built.beatFiles)
        writeFileSync(join(stage, 'beats', key + '.json'), JSON.stringify(fc));
    writeFileSync(join(stage, 'index.json'), JSON.stringify(index, null, 1));
    if (existsSync(target))
        renameSync(target, target + '.previous');
    try {
        renameSync(stage, target);
    }
    catch (e) {
        if (existsSync(target + '.previous'))
            renameSync(target + '.previous', target);
        throw e;
    }
    console.log(JSON.stringify({ totals: index.totals, coverage: { ...coverage, jurisdictions: undefined } }));
    return index;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const arg = k => process.argv[process.argv.indexOf(k) + 1];
    await build({ cache: process.argv.includes('--cache') ? arg('--cache') : null, out: process.argv.includes('--out') ? arg('--out') : null, offline: process.argv.includes('--offline'), only: process.argv.includes('--only') ? arg('--only').split(',') : undefined });
}
