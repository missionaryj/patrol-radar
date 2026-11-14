import {describe,it,expect} from 'vitest';
import {Readable} from 'node:stream';
// @ts-expect-error untyped source registry
import {SOURCES,QUARANTINED} from '../../scripts/stop-heat-sources.mjs';
// @ts-expect-error build script
import {StopValidator,number,jurisdictionContains,occupiedArea,cellPolygon,geometryArea} from '../../scripts/stop-heat-validation.mjs';
// @ts-expect-error build script
import {partsFromDate,parseHour} from '../../scripts/stop-heat-lib.mjs';
// @ts-expect-error build script
import {normalize,rows,build} from '../../scripts/build-verified-stop-heat.mjs';
// @ts-expect-error identity rules
import {chicagoEncounterKey,urbanaLocationCode,urbanaReason} from '../../scripts/stop-heat-identity.mjs';
// @ts-expect-error beat helper
import {cityBeat,HeatAgg,makeStop,serialize,BeatSet,reasonIndex} from '../../scripts/stop-heat-lib.mjs';

const geometry={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]],[[0.5,0.5],[1,0.5],[1,1],[0.5,1],[0.5,0.5]]]};
const fixture=()=>new StopValidator({contains:jurisdictionContains(geometry),start:'2000-01-01',end:'2026-12-31',asOf:'2026-11-12'});
const row={key:'one',vehicle:true,date:'2020-02-29',time:'12:00:00',hour:12,lat:1.5,lng:1.5,cite:1,warn:0,arrest:0,reason:0};
describe('Illinois source eligibility', () => {
  it('quarantines Urbana person stop sheets and maps the stop-level file only as a city shade', () => {
    expect(SOURCES.some((s: {id: string}) => s.id === 'urbana')).toBe(false);
    expect(SOURCES.find((s: {id: string; geography?: string}) => s.id === 'urbana_ivc')?.geography).toBe('city');
    expect(QUARANTINED.find((s: {id: string}) => s.id === 'urbana')?.why).toMatch(/NON-IVC/);
    expect(QUARANTINED.some((s: {id: string}) => s.id === 'urbana_offenses')).toBe(true);
    expect(QUARANTINED.some((s: {id: string}) => s.id === 'urbana_wbez')).toBe(true);
    expect(QUARANTINED.some((s: {id: string}) => s.id === 'opp_chicago')).toBe(false);
    expect(SOURCES.some((s: {id: string}) => s.id === 'opp_chicago')).toBe(true);
  });
});
describe('audited stop imports',()=>{
  it('parses multiline CSV while discarding personal columns and suppressing raw error values',async()=>{
    const found: unknown[]=[];
    await rows(Readable.from(['date,description,driver_name\r\n2020-01-01,"red light\nsecond line",PRIVATE\r\n']), (r: unknown)=>found.push(r));
    expect(found).toEqual([{date:'2020-01-01',description:'red light\nsecond line'}]);
    await expect(rows(Readable.from(['date,driver_name\n"PRIVATE']),()=>{})).rejects.toThrow('raw values suppressed');
  });
  it('refuses raw caches inside the checkout before any network request',async()=>{
    await expect(build({cache:'public/raw',out:'public/test-output'})).rejects.toThrow('Cache must be outside');
  });
  it('validates calendar dates and rejects numeric garbage',()=>{
    expect(partsFromDate('2021-02-29')).toBeNull();expect(partsFromDate('2020-02-29')).toEqual({year:2020,dow:6});
    expect(partsFromDate('2020-04-31')).toBeNull();expect(number('39.1junk')).toBeNull();expect(number('')).toBeNull();
    expect(parseHour('12:00 AM')).toBe(0);expect(parseHour('1:30 PM')).toBe(13);expect(parseHour('12:90:00')).toBeNull();expect(parseHour('13junk')).toBeNull();
  });
  it('respects holes, boundaries and disjoint polygons',()=>{
    const contains=jurisdictionContains(geometry);
    expect(contains(0.75,0.75)).toBe(false);expect(contains(1.5,1.5)).toBe(true);expect(contains(2,1)).toBe(true);expect(contains(-1,1)).toBe(false);
    expect(jurisdictionContains({type:'MultiPolygon',coordinates:[geometry.coordinates,[[[3,3],[4,3],[4,4],[3,4],[3,3]]]]})(3.5,3.5)).toBe(true);
  });
  it('collapses violation outcomes without collapsing different events at the same point',()=>{
    const v=fixture();v.add(row);v.add({...row,warn:1,reason:1});v.add({...row,key:'two'});
    expect(v.report()).toMatchObject({seen:3,accepted:2,duplicate_rows:1,rejected:0});
    expect(v.events.get('one')).toMatchObject({cite:1,warn:1,reason:null});
  });
  it('quarantines every row of a conflicting event, independent of order',()=>{
    const v=fixture();v.add(row);v.add(row);v.add({...row,lat:1.6});v.add(row);
    expect(v.report()).toMatchObject({seen:4,accepted:0,duplicate_rows:0,rejected:4,rejection_reasons:{conflicting_event:4},time_range:[null,null]});
    expect(v.cells.size).toBe(0);
  });
  it('collapses only identical Chicago public attributes', () => {
    const row = {date:'2016-05-01', time:'14:00', lat:'41.88000', lng:'-87.63000', type:'vehicular', violation:'SPEEDING', outcome:'citation', citation_issued:'TRUE', arrest_made:'FALSE', beat:'1234', subject_race:'PRIVATE'};
    expect(chicagoEncounterKey(row)).toBe(chicagoEncounterKey({...row, subject_race:'OTHER'}));
    expect(chicagoEncounterKey(row)).not.toBe(chicagoEncounterKey({...row, time:'14:30'}));
    expect(chicagoEncounterKey(row)).not.toBe(chicagoEncounterKey({...row, violation:'EQUIPMENT'}));
    expect(chicagoEncounterKey(row)).not.toBe(chicagoEncounterKey({...row, beat:'1235'}));
    const key = chicagoEncounterKey(row);
    const v = fixture();
    const base = {key, vehicle:true, date:'2016-05-01', time:'14:00', hour:14, lat:1.5, lng:1.5, cite:1, warn:0, arrest:0, reason:0};
    v.add(base); v.add({...base, arrest:1});
    expect(v.report()).toMatchObject({seen:2, accepted:1, duplicate_rows:1, rejected:0});
    expect(normalize({id:'opp_chicago', archive:'x'}, {...row, type:'pedestrian'}).vehicle).toBe(false);
    expect(normalize({id:'opp_chicago', archive:'x'}, row).key).toBe(key);
  });
  it('shades Urbana stop-level rows on the city and never on a coordinate or Champaign beat', () => {
    expect(urbanaLocationCode('547-08')).toBe('547-08');
    expect(urbanaLocationCode('61 -')).toBe('61 -');
    expect(urbanaLocationCode('999-99')).toBeNull();
    expect(urbanaLocationCode('000-00')).toBeNull();
    expect(urbanaLocationCode('547110')).toBeNull();
    expect(urbanaLocationCode('99 -')).toBeNull();
    expect(urbanaReason('LICENSE PLATE/REG.', 'NOT A MOVING VIOLATION')).toBe(reasonIndex('registration'));
    expect(urbanaReason('MOVING VIOLATION', 'SPEED')).toBe(reasonIndex('speeding'));
    const normalized = normalize({id:'urbana_ivc'}, {date_of_contact:'2018-06-02T00:00:00.000', time_of_contact:'19:30', incident_number:'A1', geo_code:'547-08', reason_for_stop:'MOVING VIOLATION', type_of_violation:'SPEED', race_description:'PRIVATE'});
    expect(normalized.lat).toBeNull();
    expect(normalized.lng).toBeNull();
    expect(normalized.locationCode).toBe('547-08');
    expect(normalized.hour).toBe(19);
    const city = new StopValidator({contains:()=>false, start:'2013-01-01', end:'2023-12-31', asOf:'2026-11-14', placement:'city'});
    expect(normalize({id:'urbana_ivc'}, {date_of_contact:'2018-06-02T00:00:00.000', time_of_contact:'19:30', incident_number:'Z', geo_code:'999-99'}).locationCode).toBeNull();
    city.add(normalized); city.add({...normalized, key:'A1'});
    city.add({...normalized, key:'bad', locationCode:null});
    city.add({...normalized, key:'A2', locationCode:null});
    const report = city.report();
    expect(report).toMatchObject({seen:4, accepted:1, duplicate_rows:1, rejected:2, rejection_reasons:{unknown_location:2}});
    expect(report.time_range).toEqual(['2018-06-02','2018-06-02']);
    expect(city.cells.size).toBe(0);
    const urbana = cityBeat({type:'Polygon', coordinates:[[[-88.24, 40.08], [-88.18, 40.08], [-88.18, 40.14], [-88.24, 40.14], [-88.24, 40.08]]]}, {prefix:'urbana_ivc', place:'Urbana city', label:'Urbana citywide total'});
    const champaign = new BeatSet('champaign', 'Champaign');
    champaign.add('547110', [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]]);
    const agg = new HeatAgg();
    agg.addBeatSet(urbana);
    agg.addBeatSet(champaign);
    agg.add(makeStop({year:2018, dow:6, hour:19, lat:null, lng:null, beatId:'city', cite:0, warn:0, arrest:0, reason:0, src:0}), urbana);
    expect(agg.units.get('champaign:547110')).toBeUndefined();
    expect(agg.units.get('urbana_ivc:CITY')?.n).toBe(1);
    const built = serialize(agg);
    expect(built.cells).toBe(0);
    expect(built.beatFiles.has('urbana_ivc')).toBe(true);
    expect(JSON.stringify(built.beatFiles.get('urbana_ivc'))).not.toMatch(/Champaign|547110/);
  });
  it('rejects Urbana/WBEZ beat codes without invented coordinates',()=> {
    // WBEZ Urbana stop records have agency-defined 4-, 5- or 2-digit codes,
    // not GPS coordinates. They cannot enter a 150 m coordinate grid.
    for (const code of ['4606', '54711', '61', '99999']) {
      const v=fixture();
      v.add({...row,key:code,lat:'',lng:'',beatId:code});
      expect(v.report()).toMatchObject({seen:1,accepted:0,rejection_reasons:{missing_or_invalid_coordinates:1}});
    }
  });
  it('reconciles every excluded row exactly, including invalid and future dates',()=>{
    const v=fixture();v.add(row);v.add({...row,vehicle:false});v.add({...row,date:'2020-02-30'});v.add({...row,date:'2026-11-13'});
    v.add({...row,lat:''});v.add({...row,lat:5});v.add({...row,key:''});
    expect(v.report()).toEqual({seen:7,accepted:1,duplicate_rows:0,rejected:6,rejection_reasons:{not_vehicle:1,invalid_date:2,missing_or_invalid_coordinates:1,outside_jurisdiction:1,missing_event_key:1},time_range:['2020-02-29','2020-02-29']});
  });
  it('requires driver roles and ignores NYPD command assignments',()=>{
    expect(normalize({id:'cincinnati'},{subjectrole:'Passenger',eventdate:'2020-01-01'}).vehicle).toBe(false);
    expect(normalize({id:'cincinnati'},{subjectrole:'Driver; Owner',eventdate:'2020-01-01'}).vehicle).toBe(true);
    expect(normalize({archive:'x'},{type:'pedestrian',date:'2020-01-01'}).vehicle).toBe(false);
    expect(normalize({id:'nypd'},{cmd_cd:'001',occur_dt:'2020-01-01'}).lat).toBeUndefined();
    expect(normalize({id:'montgomery'},{vehicle_type:'02 - Automobile'}).vehicle).toBe(true);
    expect(normalize({id:'montgomery'},{vehicle_type:'29 - Unknown'}).vehicle).toBe(false);
    expect(normalize({id:'montgomery'},{vehicle_type:'28 - Electric Bicycle'}).vehicle).toBe(false);
  });
  it('measures occupied cells once, clipped to the union, never whole jurisdictions',()=>{
    const p=cellPolygon(1.5,1.5),cells=new Map([['one',[1.5,1.5]]]);
    const area=occupiedArea(cells,[geometry,geometry]);
    expect(area).toBeCloseTo(geometryArea([p]),1);expect(area).toBeGreaterThan(22000);expect(area).toBeLessThan(22600);
    expect(occupiedArea(new Map([['hole',[0.75,0.75]]]),[geometry])).toBe(0);
  });
});
