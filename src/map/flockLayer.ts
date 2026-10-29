/** Pre-loaded, mapped Flock ALPR cameras (OpenStreetMap, ODbL). Separate from scan hits; display only. */
export interface FlockIndex { osm_base: string | null; generated: string; count: number; tileDeg: number; tiles: Record<string, number> }
export interface FlockCollection { type: 'FeatureCollection'; features: { geometry: { coordinates: [number, number] }; properties: { id: number; dir?: string } }[] }
export const FLOCK_ATTRIBUTION = 'Flock cameras: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL), via <a href="https://deflock.me">DeFlock</a>-style OSM tags';
export const FLOCK_MIN_ZOOM = 10;
/** Points inside bounds (with a small pad), capped so very dense views stay fast. */
export function flockInBounds(fc: FlockCollection, b: { south: number; west: number; north: number; east: number }, cap = 3000) {
  const out: { lat: number; lng: number; id: number; dir?: string }[] = [];
  for (const f of fc.features) {
    const [lng, lat] = f.geometry.coordinates;
    if (lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east) { out.push({ lat, lng, id: f.properties.id, dir: f.properties.dir }); if (out.length >= cap) break; }
  }
  return out;
}
/** Tile keys (south-west corner "lat_lng") overlapping bounds that exist in the index. */
export function tilesFor(idx: FlockIndex, b: { south: number; west: number; north: number; east: number }): string[] {
  const d = idx.tileDeg, out: string[] = [];
  for (let la = Math.floor(b.south / d) * d; la <= b.north; la += d) for (let ln = Math.floor(b.west / d) * d; ln <= b.east; ln += d) { const k = `${la}_${ln}`; if (k in idx.tiles) out.push(k); }
  return out;
}
