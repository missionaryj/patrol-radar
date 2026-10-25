import type { Geocoder, GeoPoint } from './types';
/** Mock: deterministic pseudo-location near a center. Real impl: Nominatim (1 req/s, UA, cache) or local Pelias, bounded to the feed's county. */
export class MockGeocoder implements Geocoder {
  constructor(private center: GeoPoint = { lat: 41.8781, lng: -87.6298 }) {}
  async geocode(location: string): Promise<GeoPoint | null> {
    if (!location) return null;
    let h = 0; for (const c of location) h = (h * 31 + c.charCodeAt(0)) | 0;
    return { lat: this.center.lat + ((h & 0xff) / 255 - 0.5) * 0.04, lng: this.center.lng + (((h >> 8) & 0xff) / 255 - 0.5) * 0.05 };
  }
}
