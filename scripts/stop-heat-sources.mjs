const OPP = 'https://stacks.stanford.edu/file/druid:';
const license = 'Open Data Commons Attribution License (ODC-BY 1.0)';
const docs = 'https://github.com/stanford-policylab/opp/blob/master/data_readme.md';
export const SOURCES = [
    { id: 'opp_mt', name: 'Montana Highway Patrol (Stanford OPP)', state: 'MT', geo: '30', kind: 'state', population: 1084225, start: '2009-01-01', end: '2017-12-31', license, docs,
        archive: OPP + 'wb225bk3255/wb225bk3255_mt_statewide_2023_01_26.csv.zip', sha256: '3cb0fe96d3e4be3ddbce89adab08cebf6ab6cebf0865c5aa11d5a90b65fc2b0e',
        note: 'Historical state patrol records, not every Montana police agency. Publisher row identity only; no independent encounter identifier. Published coordinates, accuracy unverified.' },
    { id: 'opp_vt', name: 'Vermont State Police (Stanford OPP)', state: 'VT', geo: '50', kind: 'state', population: 643077, start: '2010-07-01', end: '2015-12-31', license, docs,
        archive: OPP + 'yg821jf8611/yg821jf8611_vt_statewide_2020_04_01.csv.zip', sha256: '9e8c64ec7f7fc090b730b700f25ea9603ef01dc4afedb1dca854eac68c7df916',
        note: 'Historical state police records, not every Vermont agency. Publisher row identity only; no independent encounter identifier. Published coordinates, accuracy unverified.' },
    { id: 'opp_sf', name: 'San Francisco Police (Stanford OPP)', state: 'CA', geo: '0667000', kind: 'place', population: 873965, start: '2007-01-01', end: '2016-06-30', license, docs,
        archive: OPP + 'yg821jf8611/yg821jf8611_ca_san_francisco_2020_04_01.csv.zip', sha256: 'e6a2bd70cdfd249b091b82db04020f3d793523589bd8c5fd667fcd4981df759a',
        note: 'Historical vehicle stops. OPP deduplicated raw fields; publisher row identity only here. Do not combine overlapping RIPA/municipal records. Published coordinates, accuracy unverified.' },
    { id: 'cincinnati', name: 'Cincinnati Police Contact Cards — drivers', state: 'OH', geo: '3915000', kind: 'place', population: 309317, start: '1990-01-01', end: '2099-12-31', license: 'Public Domain (publisher metadata)',
        domain: 'data.cincinnati-oh.gov', dataset: 'unm9-wj3w', select: 'reportnumber,eventdate,subjectrole,lat_x,lon_x,reasonsforstop,primaryactiontaken',
        note: 'Only explicit driver roles; passengers, pedestrians, owners without a driver role and unknown roles excluded. Report number deduplication; no personal or officer fields retained. Coordinates supplied by publisher.' },
    { id: 'nypd', name: 'NYPD Vehicle Stop Reports', state: 'NY', geo: '3651000', kind: 'place', population: 8804190, start: '1990-01-01', end: '2099-12-31', license: 'NYC Open Data terms of use',
        domain: 'data.cityofnewyork.us', dataset: 'hn9i-dwpr', select: 'evnt_key,occur_dt,occur_tm,summon_issued_flg,arrest_made_flg,latitude,longitude',
        note: 'Event-key deduplication. Publisher anonymized coordinates; 150 m cells do not imply 150 m source accuracy. Command code is officer assignment and is never used as stop location.' },
    { id: 'montgomery', name: 'Montgomery County MD traffic violations — stop IDs', state: 'MD', geo: '24031', kind: 'county', population: 1062061, start: '1990-01-01', end: '2099-12-31', license: 'dataMontgomery terms of use (verify reuse before commercialization)',
        domain: 'data.montgomerycountymd.gov', dataset: '4mse-ku6q', select: 'seq_id,date_of_stop,time_of_stop,latitude,longitude,vehicle_type,violation_type,description',
        note: 'Only known motor-vehicle categories 01–27; other/unknown and electric bicycle categories excluded. Violation rows collapse by publisher stop ID with outcomes merged. Conflicting valid locations/dates quarantine the entire event.' },
];
export const QUARANTINED = [
    { id: 'opp_chicago', name: 'Chicago OPP', url: docs, why: 'OPP documents unresolved duplicates and hourly time resolution. The previous 2,108,098 rows cannot be claimed as unique encounters; withheld pending a defensible encounter rule.' },
    { id: 'urbana', name: 'Urbana IDOT stop sheets', url: 'https://data.illinois.gov/d/vnxf-tjw4', why: 'Prior build joined Urbana codes to Champaign beats. Withheld pending source event-key and correct Urbana geography validation.' },
    { id: 'ct_stops', name: 'Connecticut traffic stops', url: 'https://data.ct.gov/d/nahi-zqrt', why: 'Town/intersection locations require a separately validated coarse geography adapter; no fabricated street points.' },
];
export function sourceURL(s) { return s.archive ?? `https://${s.domain}/d/${s.dataset}`; }
export function boundaryURL(s) {
    const root = 'https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/tigerWMS_Census2020/MapServer';
    const layer = { state: 80, place: 26, county: 82 }[s.kind];
    const u = new URL(`${root}/${layer}/query`);
    u.search = new URLSearchParams({ where: `GEOID='${s.geo}'`, outFields: 'GEOID,NAME,POP100,AREALAND,AREAWATER', returnGeometry: 'true', outSR: '4326', f: 'geojson' });
    return u.href;
}
