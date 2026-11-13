import {describe,it,expect} from 'vitest';
// @ts-expect-error research-only adapter
import {createUrbanaAudit,locationScheme,validDate,validTime,auditUrbanaFile} from '../../scripts/urbana-staging.mjs';

const row={id:'publisher1',record_ref:'row1',year:'2021',AgencyCode:'13100',AgencyName:'URBANA POLICE',DateOfStop:'2021-01-01',TimeOfStop:'12:30:00',BeatLocationOfStop:'61',ReasonForStop:'1',TypeOfMovingViolation:'2',ResultOfStop:'3'};
describe('Urbana research quarantine',()=>{
  it('keeps matching rows as uncertain identity and never emits mapped events or personal fields',()=>{
    const audit=createUrbanaAudit();
    audit.add({...row,DriverSex:'PRIVATE',ZIP:'PRIVATE',lat:40,lng:-88});
    audit.add({...row,id:'publisher2',record_ref:'row2'});
    const report=audit.report();
    expect(report).toMatchObject({seen:2,distinct_row_ids:2,candidate_duplicate_groups:1,candidate_duplicate_excess_rows:1,accepted_mapped_records:0,occupied_cells:0});
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|publisher1|row1|coordinates|latitude|longitude/);
  });
  it('does not silently map unknown, mixed-era or other-city codes',()=>{
    expect(locationScheme(2021,'99999')).toBe('unknown');
    expect(locationScheme(2021,'54711')).toBe('unresolved');
    expect(locationScheme(2006,'4606')).toBe('historical_four_digit');
    expect(locationScheme(2007,'54606')).toBe('historical_five_digit');
    expect(locationScheme(2020,'61')).toBe('unresolved');
    const audit=createUrbanaAudit(); audit.add({...row,AgencyName:'CHAMPAIGN POLICE'});
    expect(audit.report()).toMatchObject({wrong_agency:1,accepted_mapped_records:0});
  });
  it('checks full civil dates, year agreement and clock ranges',()=>{
    expect(validDate('2021-02-29')).toBe(false); expect(validDate('2020-02-29')).toBe(true);
    for(const t of ['', '24:00:00','12:60:00','12:00:60','12:00junk']) expect(validTime(t)).toBe(false);
    expect(validTime('00:00:00')).toBe(true);
    const audit=createUrbanaAudit(); audit.add({...row,year:'2020',TimeOfStop:''});
    expect(audit.report()).toMatchObject({year_mismatch:1,invalid_time:1});
  });
  it('refuses raw files in checkout and does not reveal file contents',async()=>{
    await expect(auditUrbanaFile(new URL('../../package.json',import.meta.url))).rejects.toThrow('outside checkout');
  });
});
