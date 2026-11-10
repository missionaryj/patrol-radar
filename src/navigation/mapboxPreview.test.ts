import { describe, expect, it, vi } from 'vitest';
import { drivingRoutes, findDestination } from './mapboxPreview';

const chicago = { lat: 41.88, lng: -87.63 };
const signal = () => new AbortController().signal;
const feature = (lng: number, lat: number, name: string, type = 'poi', fullAddress = 'Chicago, Illinois, United States') => ({
  geometry: { coordinates: [lng, lat] },
  properties: { name, feature_type: type, full_address: fullAddress, place_formatted: 'Illinois, United States' }
});
const response = (features: unknown[]) => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features }) });

describe('Mapbox preview', () => {
  it('searches Mapbox Search Box for real POIs, biased toward current GPS coordinates', async () => {
    const mock = response([feature(-87.625, 41.885, "McDonald's", 'poi', '100 Main St, Chicago, IL')]);
    const places = await findDestination("McDonald's", 'pk.test', chicago, signal(), mock);
    expect(places[0]).toMatchObject({ name: "McDonald's", address: '100 Main St, Chicago, IL',
      label: "McDonald's, 100 Main St, Chicago, IL" });
    const url = new URL(mock.mock.calls[0][0]);
    expect(url.pathname).toBe('/search/searchbox/v1/forward');
    expect(url.searchParams.get('q')).toBe("McDonald's");
    expect(url.searchParams.get('proximity')).toBe('-87.63,41.88');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.has('permanent')).toBe(false);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('returns nearby business results first even if Mapbox returns distant matches earlier', async () => {
    const mock = response([
      feature(14.3, 48.2, "McDonald's", 'poi', 'Austria'),
      feature(-87.65, 41.9, "McDonald's", 'poi', 'Chicago north'),
      feature(-87.631, 41.881, "McDonald's", 'poi', 'Chicago center')
    ]);
    const places = await findDestination("McDonald's", 'pk.test', chicago, signal(), mock);
    expect(places.map(p => p.address)).toEqual(['Chicago center', 'Chicago north', 'Austria']);
    expect(places[0].distanceMeters).toBeLessThan(places[1].distanceMeters!);
  });
  it('preserves provider relevance for explicit addresses rather than reordering by distance', async () => {
    const mock = response([
      feature(-96.8, 32.78, '123 Main Street', 'address', '123 Main Street, Dallas, TX'),
      feature(-87.63, 41.881, 'Main Street', 'address', 'Main Street, Chicago, IL')
    ]);
    const places = await findDestination('123 Main Street, Dallas', 'pk.test', chicago, signal(), mock);
    expect(places.map(p => p.label)).toEqual(['123 Main Street, Dallas, TX', 'Main Street, Chicago, IL']);
  });
  it('ignores invalid coordinates and caps saved-place labels to the supported length', async () => {
    const mock = response([feature(200, 10, 'Invalid'), feature(-87.62, 41.88, 'Shop', 'poi', 'A'.repeat(210))]);
    const places = await findDestination('Shop', 'pk.test', chicago, signal(), mock);
    expect(places).toHaveLength(1);
    expect(places[0].label.length).toBe(180);
  });
  it('requests traffic routing and GeoJSON', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code:'Ok',routes:[{distance:1000,duration:150,geometry:{coordinates:[[-87.7,41.8],[-87.6,41.9]]}}] }) });
    expect((await drivingRoutes({lat:41.8,lng:-87.7},{lat:41.9,lng:-87.6},'pk.test',signal(),mock))[0].durationSeconds).toBe(150);
    expect(mock.mock.calls[0][0]).toContain('/mapbox/driving-traffic/');
  });
  it('refuses unconfigured tokens and invalid GPS fixes', async () => {
    await expect(findDestination('Chicago','',chicago,signal())).rejects.toThrow('not configured');
    await expect(findDestination('Chicago','pk.test',{lat:999,lng:-87.63},signal())).rejects.toThrow('GPS');
  });
});
