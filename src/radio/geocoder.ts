import type { Geocoder, GeoPoint } from './types';
/** Mock: deterministic pseudo-location near a center. */
export class MockGeocoder implements Geocoder {
  constructor(private center: GeoPoint = CHAMPAIGN) {}
  async geocode(location: string): Promise<GeoPoint | null> {
    if (!location) return null;
    let h = 0; for (const c of location) h = (h * 31 + c.charCodeAt(0)) | 0;
    return { lat: this.center.lat + ((h & 0xff) / 255 - 0.5) * 0.04, lng: this.center.lng + (((h >> 8) & 0xff) / 255 - 0.5) * 0.05 };
  }
}
export const CHAMPAIGN: GeoPoint = { lat: 40.1106, lng: -88.2073 };
const norm = (s: string) => s.toLowerCase().replace(/\b(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd)\b\.?/g, '').replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Local lookup of common C-U intersections/landmarks (approximate, coarsened anyway). No network. */
export const CU_GAZETTEER: Record<string, GeoPoint> = {
  'neil & university': { lat: 40.1164, lng: -88.2434 }, 'green & wright': { lat: 40.1101, lng: -88.2290 },
  'green & sixth': { lat: 40.1101, lng: -88.2324 }, 'green & 6th': { lat: 40.1101, lng: -88.2324 },
  'prospect & springfield': { lat: 40.1127, lng: -88.2626 }, 'prospect & bloomington': { lat: 40.1291, lng: -88.2628 },
  'mattis & kirby': { lat: 40.0985, lng: -88.2805 }, 'neil & kirby': { lat: 40.0982, lng: -88.2434 },
  'lincoln & university': { lat: 40.1166, lng: -88.2193 }, 'cunningham & university': { lat: 40.1164, lng: -88.2027 },
  'philo & windsor': { lat: 40.0838, lng: -88.1951 }, 'market & bradley': { lat: 40.1310, lng: -88.2425 },
  'main & race': { lat: 40.1123, lng: -88.2077 }, 'first & armory': { lat: 40.1043, lng: -88.2384 },
  'kirby & duncan': { lat: 40.0982, lng: -88.2905 }, 'lincoln & florida': { lat: 40.1003, lng: -88.2193 },
  'market place mall': { lat: 40.1405, lng: -88.2440 }, 'lincoln square': { lat: 40.1129, lng: -88.2073 },
};
export class LocalLookupGeocoder implements Geocoder {
  constructor(private table = CU_GAZETTEER) {}
  async geocode(location: string) {
    const n = norm(location); if (this.table[n]) return this.table[n];
    const [a, b] = n.split(' & '); if (b && this.table[`${b} & ${a}`]) return this.table[`${b} & ${a}`];
    return null;
  }
}
/** Nominatim (OSM). Usage policy: max 1 req/s, cache results, identify the app. Bounded to Champaign County. */
export class NominatimGeocoder implements Geocoder {
  private cache = new Map<string, GeoPoint | null>(); private queue: Promise<unknown> = Promise.resolve(); private last = 0;
  constructor(private opts: { minIntervalMs?: number; city?: string; email?: string; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}) {}
  geocode(location: string): Promise<GeoPoint | null> {
    const key = norm(location); if (!key) return Promise.resolve(null);
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key)!);
    const run = async () => {
      if (this.cache.has(key)) return this.cache.get(key)!;
      const now = this.opts.now ?? Date.now, sleep = this.opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
      const wait = this.last + (this.opts.minIntervalMs ?? 1100) - now(); if (wait > 0) await sleep(wait);
      this.last = now();
      const q = location.replace(/\s*&\s*/, ' and ') + `, ${this.opts.city ?? 'Champaign County, Illinois'}`;
      const p = new URLSearchParams({ q, format: 'jsonv2', limit: '1', viewbox: '-88.47,40.40,-87.93,39.87', bounded: '1', ...(this.opts.email ? { email: this.opts.email } : {}) });
      let pt: GeoPoint | null = null;
      try { const r = await (this.opts.fetchFn ?? fetch)(`https://nominatim.openstreetmap.org/search?${p}`); const j = await r.json(); if (j[0]) pt = { lat: +j[0].lat, lng: +j[0].lon }; } catch { pt = null; }
      this.cache.set(key, pt); return pt;
    };
    const r = this.queue.then(run, run); this.queue = r.catch(() => {}); return r;
  }
}
/** Try geocoders in order (e.g. local lookup, then Nominatim). */
export class ChainGeocoder implements Geocoder {
  constructor(private chain: Geocoder[]) {}
  async geocode(l: string) { for (const g of this.chain) { const p = await g.geocode(l); if (p) return p; } return null; }
}
