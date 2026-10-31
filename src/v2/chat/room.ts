// City room from the coarse grid cell, computed entirely on device.
// Choice: an offline city list (GeoNames cities1000, US, CC BY 4.0) shipped as a static file, so NOTHING about
// location leaves the phone (a reverse-geocode API would see the cell centre on every lookup, even if coarse).
// We take the already-coarsened ~150 m cell centre and pick the nearest place, weighting bigger places a bit so a
// suburb doesn't steal a downtown cell. Beyond MAX_KM from any place, the room is the state ("Rural IL").
export type CityRow = [name: string, state: string, lat: number, lng: number, pop: number];
export interface Room { key: string; label: string }
export const MAX_KM = 25;

const slug = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'x';
function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = Math.PI / 180, x = (bLng - aLng) * r * Math.cos(((aLat + bLat) / 2) * r), y = (bLat - aLat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}
/** cell must be the coarse grid-cell centre (see map/coarsen.ts), never the raw GPS fix. */
const stCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'XX';
export function roomFor(cell: { lat: number; lng: number }, rows: CityRow[], country = 'US'): Room | null {
  let best: CityRow | undefined, bestScore = Infinity, bestKm = Infinity;
  for (const c of rows) {
    if (Math.abs(c[2] - cell.lat) > 0.5) continue;
    const d = km(cell.lat, cell.lng, c[2], c[3]);
    if (d > MAX_KM) continue;
    const score = d / (1 + Math.log10(Math.max(1000, c[4])) / 4); // mild preference for bigger places
    if (score < bestScore) { bestScore = score; best = c; bestKm = d; }
  }
  if (best) return { key: `${country.toUpperCase()}-${stCode(best[1])}-${slug(best[0])}`, label: `${best[0]}, ${best[1]}` };
  // Rural fallback: nearest place's state, at any distance up to 150 km.
  let st: CityRow | undefined, sd = Infinity;
  for (const c of rows) { if (Math.abs(c[2] - cell.lat) > 1.5) continue; const d = km(cell.lat, cell.lng, c[2], c[3]); if (d < sd) { sd = d; st = c; } }
  void bestKm;
  return st && sd < 150 ? { key: `${country.toUpperCase()}-${stCode(st[1])}-rural`, label: `Rural ${st[1]}` } : null;
}

let cache: Promise<CityRow[]> | undefined;
export function loadCities(base = import.meta.env.BASE_URL): Promise<CityRow[]> {
  return (cache ??= fetch(`${base}data/cities/us.json`).then(r => r.json()).then(j => j.rows as CityRow[]));
}
