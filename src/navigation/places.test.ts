import {describe,it,expect} from 'vitest';
import {readPlaces,putPlace,samePlace} from './places';
const a={lat:41.88,lng:-87.63,label:'Chicago'};
describe('locally saved navigation places',()=>{
 it('ignores invalid or oversized stored data',()=>{expect(readPlaces('{bad')).toEqual([]);expect(readPlaces('"test"')).toEqual([]);expect(readPlaces('x'.repeat(10001))).toEqual([])});
 it('rejects unsafe coordinates and empty labels',()=>{expect(readPlaces(JSON.stringify([a,{lat:999,lng:0,label:'bad'},{lat:0,lng:0,label:''}]))).toEqual([a])});
 it('deduplicates by location and bounds history',()=>{const b={...a,label:'Downtown'};expect(samePlace(a,b)).toBe(true);expect(putPlace([a],b)).toEqual([b]);expect(putPlace(Array.from({length:10},(_,i)=>({...a,lat:i})),{...a,lat:42},8)).toHaveLength(8)});
});
