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
    { id: 'opp_chicago', name: 'Chicago Police (Stanford OPP) — vehicle stops', state: 'IL', geo: '1714000', kind: 'place', population: 2746388, start: '2012-01-01', end: '2020-05-16', license, docs,
        archive: OPP + 'wb225bk3255/wb225bk3255_il_chicago_2023_01_26.csv.zip', sha256: 'd7c671d3fa0f03ae07900b39753f1d9c1decbe3131b4736b1ff720a7dd6fabea',
        note: 'Vehicle stops only, clipped to the 2020 Chicago city boundary. Identical public attributes (date, time, latitude, longitude, type, violation, citation, arrest, outcome, and beat) collapse to one row. Rows that differ in any of those stay separate: a shared hour and a geocoded intersection can be two vehicles. Stanford still warns that duplicates can remain because many times are hourly and officer ids are incomplete, so this is not a certified unique-stop count. Publisher geocodes; accuracy unverified. ODC-BY.' },
    { id: 'urbana_ivc', name: 'Urbana Police IDOT traffic stops — stop level', state: 'IL', geo: '1777005', kind: 'place', population: 38336, start: '2013-01-01', end: '2023-12-31', geography: 'city',
        license: 'City of Urbana data hosted on data.illinois.gov; attribute the dataset. Portal policy: 20 ILCS 45/15 and 45/25.',
        domain: 'data.illinois.gov', dataset: '5r4s-jwyk', select: 'date_of_contact,time_of_contact,incident_number,geo_code,reason_for_stop,type_of_violation',
        cityLabel: 'Urbana citywide total — agency geocodes are not drawn',
        note: 'Official stop-level Illinois traffic stops for Urbana police, not the investigatory stop sheet and not the offense-level table. Incident number is the event key; conflicting copies of one incident are dropped. Location values are geocodes such as NNN-NN or beat labels 61–65, and 999-99 is excluded as unknown. This file has no coordinates. The public Urbana GIS folder publishes a residency buffer, not beat or geocode polygons, so every accepted stop is shaded once on the 2020 Census city boundary. That shade is a citywide total, not a street, a 150 m cell, or a Champaign beat. 2023 in this file is not a certified full year. The WBEZ department extract is not used: it has no coordinates and no explicit commercial data license.' },
];
export const QUARANTINED = [
    { id: 'urbana', name: 'Urbana IDOT stop sheets', url: 'https://data.illinois.gov/d/vnxf-tjw4', why: 'Person-level investigatory stops. MOTOR VEHICLE NON-IVC means a vehicle occupant outside the traffic-stop collection, not an ordinary vehicle stop. The mapped Urbana layer uses stop-level dataset 5r4s-jwyk instead. These rows are never joined to Champaign beats.' },
    { id: 'urbana_offenses', name: 'Urbana IDOT traffic-stop offenses', url: 'https://data.illinois.gov/d/vzjr-d62i', why: 'Offense-level rows for the same stops as dataset 5r4s-jwyk. Not summed with the stop-level layer.' },
    { id: 'urbana_wbez', name: 'WBEZ Urbana traffic-stop extract', url: 'https://interactive.wbez.org/traffic-stops/urbana-police/', why: 'Not published. The extract has no coordinates, no public beat polygons were available, and WBEZ has not stated a commercial data license. The official stop-level file is the mapped source.' },
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
