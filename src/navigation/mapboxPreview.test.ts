import { describe, expect, it, vi } from 'vitest';
import { drivingRoutes, findDestination } from './mapboxPreview';

const origin={lat:41.88,lng:-87.63}, signal=new AbortController().signal;
const feature=(name:string,lng:number,lat:number,osm_key='amenity')=>({
  geometry:{coordinates:[lng,lat]},properties:{name,osm_key,city:'Chicago',country:'United States'}
});
const search=(features:unknown[])=>vi.fn().mockResolvedValue({ok:true,json:async()=>({features})});
describe('navigation destination search',()=>{
  it('queries OSM Photon with current GPS bias without Mapbox Search Box licensing restrictions',async()=>{
    const mock=search([feature("McDonald's",-87.62,41.88)]);
    expect((await findDestination("McDonald's",'pk.test',origin,signal,mock))[0].label).toContain("McDonald's");
    const url=new URL(mock.mock.calls[0][0]);
    expect(url.hostname).toBe('photon.komoot.io');
    expect(url.pathname).toBe('/api');
    expect(url.searchParams.get('lon')).toBe('-87.63');
    expect(url.searchParams.get('lat')).toBe('41.88');
    expect(url.searchParams.get('limit')).toBe('30');
    expect(url.searchParams.get('zoom')).toBe('14');
    expect(url.searchParams.get('location_bias_scale')).toBe('0.1');
    expect(url.searchParams.has('access_token')).toBe(false);
  });
  it('ranks nearby restaurants before far ones',async()=>{
    const mock=search([feature('Far away',14.3,48.2),feature('Nearby',-87.631,41.881)]);
    const places=await findDestination("McDonald's",'pk.test',origin,signal,mock);
    expect(places.map(p=>p.label.split(',')[0])).toEqual(['Nearby','Far away']);
  });
  it('ranks a nearby business even when the provider returned more than ten distant matches',async()=>{
    const remote=Array.from({length:15},(_,i)=>feature('Distant '+i,-96.8-i*.01,32.78));
    const mock=search([...remote,feature('McDonald near me',-87.6301,41.8801)]);
    const places=await findDestination("McDonald's",'pk.test',origin,signal,mock);
    expect(places).toHaveLength(10);
    expect(places[0].label).toContain('McDonald near me');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('deduplicates identical place listings before displaying nearby search results',async()=>{
    const repeated=feature('McDonald near me',-87.63,41.88);
    const places=await findDestination("McDonald's",'pk.test',origin,signal,search([repeated,repeated,feature('Other',-87.631,41.88)]));
    expect(places).toHaveLength(2);
  });
  it('preserves provider relevance for house-number addresses, even when far away',async()=>{
    const mock=search([feature('1600 Pennsylvania Ave',-77.0365,38.8977),feature('1600 Pennsylvania Ave in Chicago',-87.63,41.88)]);
    expect((await findDestination('1600 Pennsylvania Avenue','pk.test',origin,signal,mock))[0].label).toContain('Pennsylvania Ave,');
  });
  it('preserves provider relevance for addresses in another city',async()=>{
    const mock=search([feature('Dallas',-96.8,32.78,'highway'),feature('Chicago',-87.63,41.88,'highway')]);
    expect((await findDestination('Dallas address','pk.test',origin,signal,mock)).map(p=>p.label.split(',')[0]))
      .toEqual(['Dallas','Chicago']);
  });
  it('ignores malformed coordinates, caps stored labels',async()=>{
    const mock=search([{geometry:{coordinates:42}},feature('Invalid',999,42),feature('A'.repeat(210),-87.62,41.88)]);
    const places=await findDestination('shop','pk.test',origin,signal,mock);
    expect(places).toHaveLength(1);
    expect(places[0].label.length).toBe(180);
  });
  it('keeps existing Mapbox Directions traffic routing',async()=>{
    const mock=vi.fn().mockResolvedValue({ok:true,json:async()=>({code:'Ok',routes:[{distance:1000,duration:150,geometry:{coordinates:[[-87.7,41.8],[-87.6,41.9]]}}]})});
    expect((await drivingRoutes(origin,{lat:41.9,lng:-87.6},'pk.test',signal,mock))[0].durationSeconds).toBe(150);
    expect(mock.mock.calls[0][0]).toContain('/mapbox/driving-traffic/');
  });
  it('refuses unconfigured Mapbox routing and invalid GPS',async()=>{
    await expect(findDestination('Chicago','',origin,signal)).rejects.toThrow('not configured');
    await expect(findDestination('Chicago','pk.test',{lat:999,lng:0},signal)).rejects.toThrow('GPS');
  });
});
