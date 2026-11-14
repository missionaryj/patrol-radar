// Research-only Urbana adapter. No geometry, cells, or publishable events are emitted.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'csv-parse';

export const URBANA_SHA256 = 'ac810a5982057de5fb71ecd31f550266659acecc0b41da2155ffdf1f125b499b';
const fields = ['id','record_ref','year','AgencyCode','AgencyName','DateOfStop','TimeOfStop','BeatLocationOfStop','ReasonForStop','TypeOfMovingViolation','ResultOfStop'];
const hash = value => createHash('sha256').update(value).digest('hex');
const increment = (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1);
// Figure 1, p.4, UPD 2019 report. Comparison totals, never replacement events.
const reportAnnual = {2010:3099,2011:2909,2012:3777,2013:4313,2014:4210,2015:3663,2016:3316,2017:2991,2018:3515,2019:3245};
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0,10) === value;
}
export function validTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value); }
export function locationScheme(year, code) {
  if (code === '99999') return 'unknown';
  if (year >= 2004 && year <= 2006 && /^\d{4}$/.test(code)) return 'historical_four_digit';
  if (year >= 2007 && year <= 2020 && /^\d{5}$/.test(code)) return 'historical_five_digit';
  if (year >= 2021 && year <= 2022 && /^6[1-5]$/.test(code)) return 'modern_beat';
  return 'unresolved'; // Observed format is not a crosswalk or geographic validation.
}

export function createUrbanaAudit() {
  const ids = new Map(), refs = new Map(), candidates = new Map(), exact = new Map();
  const annual = new Map(), schemes = new Map(), codes = new Set();
  let seen=0, wrongAgency=0, invalidDate=0, yearMismatch=0, invalidTime=0, unknown=0;
  return {
    add(input) {
      const r = Object.fromEntries(fields.map(k => [k, String(input[k] ?? '').trim()]));
      seen++;
      if (r.AgencyCode !== '13100' || r.AgencyName !== 'URBANA POLICE') wrongAgency++;
      const dateOK = validDate(r.DateOfStop);
      if (!dateOK) invalidDate++;
      if (dateOK && String(Number(r.year)) !== r.DateOfStop.slice(0,4)) yearMismatch++;
      if (!validTime(r.TimeOfStop)) invalidTime++;
      increment(annual, r.year); increment(schemes, locationScheme(+r.year,r.BeatLocationOfStop));
      codes.add(r.BeatLocationOfStop);
      if (r.BeatLocationOfStop === '99999') unknown++;
      if (r.id) increment(ids, hash(r.id));
      if (r.record_ref) increment(refs, hash(r.record_ref));
      increment(candidates, hash(JSON.stringify(['DateOfStop','TimeOfStop','BeatLocationOfStop','ReasonForStop','TypeOfMovingViolation','ResultOfStop'].map(k=>r[k]))));
      // Only allowlisted non-person fields; no raw records or hashes leave this object.
      increment(exact, hash(JSON.stringify(fields.filter(k=>!['id','record_ref'].includes(k)).map(k=>r[k]))));
    },
    report() {
      const excess = map => [...map.values()].reduce((sum,n)=>sum+n-1,0);
      const groups = map => [...map.values()].filter(n=>n>1).length;
      const subtotal = [...annual].filter(([year])=>+year>=2010 && +year<=2019).reduce((sum,[,n])=>sum+n,0);
      return {status:'research_only_blocked', seen, annual_rows:Object.fromEntries([...annual].sort()),
        wrong_agency:wrongAgency, invalid_date:invalidDate, year_mismatch:yearMismatch, invalid_time:invalidTime,
        distinct_row_ids:ids.size, distinct_record_refs:refs.size,
        candidate_duplicate_groups:groups(candidates), candidate_duplicate_excess_rows:excess(candidates),
        identical_safe_field_excess_rows:excess(exact), identity_policy:'No automatic deduplication: row IDs and matching safe fields do not prove encounter identity.',
        distinct_location_codes:codes.size, unknown_location_rows:unknown, observed_schemes:Object.fromEntries(schemes),
        rows_2010_2019:subtotal, report_total_2010_2019:35038, report_minus_source:35038-subtotal,
        annual_report_minus_source:Object.fromEntries(Object.entries(reportAnnual).map(([year,n])=>[year,n-(annual.get(year)??0)])),
        accepted_mapped_records:0, occupied_cells:0,
        blockers:['effective_dated_official_urbana_polygons_and_crosswalk','source_event_identity_and_overlap_reconciliation','source_and_boundary_commercial_reuse_rights']};
    }
  };
}

export async function auditUrbanaFile(filename) {
  const resolved = await realpath(filename);
  const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
  const relative = path.relative(root,resolved);
  if (!relative || (!relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Raw source must stay outside checkout');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(resolved)) digest.update(chunk);
  if (digest.digest('hex') !== URBANA_SHA256) throw new Error('Unrecognized source checksum; independent source review required');
  const audit = createUrbanaAudit();
  try {
    const parser = createReadStream(resolved).pipe(parse({bom:true,columns:header=>{
      if (!fields.every(k=>header.includes(k)) || new Set(header).size!==header.length) throw new Error('Invalid schema');
      return header.map(k=>fields.includes(k)?k:false);
    }}));
    for await (const row of parser) audit.add(row);
  } catch { throw new Error('Urbana CSV audit failed; raw values suppressed'); }
  return {source_sha256:URBANA_SHA256,...audit.report()};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await auditUrbanaFile(process.argv[2]),null,2)); }
  catch { console.error('Urbana audit refused or failed; check source path, checksum and schema. Raw values suppressed.'); process.exitCode=1; }
}
