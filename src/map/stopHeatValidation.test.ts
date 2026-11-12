import {describe,it,expect} from 'vitest';
import {Readable} from 'node:stream';
// @ts-expect-error build script
import {StopValidator,number,jurisdictionContains,occupiedArea,cellPolygon,geometryArea} from '../../scripts/stop-heat-validation.mjs';
// @ts-expect-error build script
import {partsFromDate,parseHour} from '../../scripts/stop-heat-lib.mjs';
// @ts-expect-error build script
import {normalize,rows,build} from '../../scripts/build-verified-stop-heat.mjs';

const geometry={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]],[[0.5,0.5],[1,0.5],[1,1],[0.5,1],[0.5,0.5]]]};
const fixture=()=>new StopValidator({contains:jurisdictionContains(geometry),start:'2000-01-01',end:'2026-12-31',asOf:'2026-11-12'});
const row={key:'one',vehicle:true,date:'2020-02-29',time:'12:00:00',hour:12,lat:1.5,lng:1.5,cite:1,warn:0,arrest:0,reason:0};
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
