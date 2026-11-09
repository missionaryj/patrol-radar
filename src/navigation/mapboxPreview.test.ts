import { describe, expect, it, vi } from 'vitest';
import { drivingRoutes, findDestination } from './mapboxPreview';
describe('Mapbox preview', () => {
  it('geocodes only on user action using temporary Geocoding v6', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [{ geometry: { coordinates: [-87.62, 41.88] }, properties: { name: 'Chicago' } }] }) });
    expect((await findDestination('Chicago', 'pk.test', {lat:41.8,lng:-87.7}, new AbortController().signal, mock))[0].label).toBe('Chicago');
    const url = new URL(mock.mock.calls[0][0]);
    expect(url.pathname).toContain('/search/geocode/v6/forward');
    expect(url.searchParams.get('autocomplete')).toBe('false');
    expect(url.searchParams.has('permanent')).toBe(false);
  });
  it('requests traffic routing and GeoJSON', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code:'Ok',routes:[{distance:1000,duration:150,geometry:{coordinates:[[-87.7,41.8],[-87.6,41.9]]}}] }) });
    expect((await drivingRoutes({lat:41.8,lng:-87.7},{lat:41.9,lng:-87.6},'pk.test',new AbortController().signal,mock))[0].durationSeconds).toBe(150);
    expect(mock.mock.calls[0][0]).toContain('/mapbox/driving-traffic/');
  });
  it('refuses unconfigured tokens', async () => {
    await expect(findDestination('Chicago','',{lat:41.8,lng:-87.7},new AbortController().signal)).rejects.toThrow('not configured');
  });
});
