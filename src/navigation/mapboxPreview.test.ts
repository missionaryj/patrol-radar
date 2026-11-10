import { describe, expect, it, vi } from 'vitest';
import { drivingRoutes, findDestination } from './mapboxPreview';

const origin = {lat:41.88,lng:-87.63}, signal = new AbortController().signal;
const feature = (address:string,lng:number,lat:number,type='poi') => ({
  geometry:{coordinates:[lng,lat]}, properties:{feature_type:type,name:'McDonald\'s',full_address:address}
});
const mockSearch = (features:unknown[]) => vi.fn().mockResolvedValue({ok:true,json:async()=>({features})});

describe('Mapbox preview', () => {
  it('searches businesses with live GPS proximity', async () => {
    const mock = mockSearch([feature('Chicago, IL',-87.62,41.88)]);
    expect((await findDestination('McDonald\'s','pk.test',origin,signal,mock))[0].label).toBe("McDonald's, Chicago, IL");
    const url = new URL(mock.mock.calls[0][0]);
    expect(url.pathname).toBe('/search/searchbox/v1/forward');
    expect(url.searchParams.get('proximity')).toBe('-87.63,41.88');
    expect(url.searchParams.get('limit')).toBe('10');
  });
  it('puts nearby restaurants ahead of distant locations', async () => {
    const mock = mockSearch([feature('Austria',14.3,48.2),feature('Nearby',-87.631,41.881)]);
    expect((await findDestination('McDonald\'s','pk.test',origin,signal,mock)).map(p=>p.label))
      .toEqual(["McDonald's, Nearby","McDonald's, Austria"]);
  });
  it('keeps relevance ordering for explicit address searches', async () => {
    const mock = mockSearch([feature('Dallas, TX',-96.8,32.78,'address'),feature('Chicago, IL',-87.63,41.88,'address')]);
    expect((await findDestination('Dallas address','pk.test',origin,signal,mock)).map(p=>p.label))
      .toEqual(['Dallas, TX','Chicago, IL']);
  });
  it('rejects invalid coordinates and caps labels for saved places', async () => {
    const mock = mockSearch([feature('Invalid',999,41.88),{geometry:{coordinates:42}},feature('A'.repeat(200),-87.62,41.88)]);
    const places = await findDestination('McDonald\'s','pk.test',origin,signal,mock);
    expect(places).toHaveLength(1);
    expect(places[0].label.length).toBe(180);
  });
  it('requests traffic routing and GeoJSON', async () => {
    const mock = vi.fn().mockResolvedValue({ok:true,json:async()=>({code:'Ok',routes:[{distance:1000,duration:150,geometry:{coordinates:[[-87.7,41.8],[-87.6,41.9]]}}]})});
    expect((await drivingRoutes(origin,{lat:41.9,lng:-87.6},'pk.test',signal,mock))[0].durationSeconds).toBe(150);
    expect(mock.mock.calls[0][0]).toContain('/mapbox/driving-traffic/');
  });
  it('refuses missing tokens and invalid GPS', async () => {
    await expect(findDestination('Chicago','',origin,signal)).rejects.toThrow('not configured');
    await expect(findDestination('Chicago','pk.test',{lat:999,lng:0},signal)).rejects.toThrow('GPS');
  });
});
