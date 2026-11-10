/** Real Mapbox route PREVIEW, not active turn-by-turn guidance. Search results are temporary; check storage terms before saving them. */
export interface Coordinate { lat: number; lng: number }
export interface Destination extends Coordinate { label: string }
export interface RouteStep { instruction: string; location: [number,number]; distanceMeters: number }
export type Congestion = 'low' | 'moderate' | 'heavy' | 'severe' | 'unknown';
export interface PreviewRoute { distanceMeters: number; durationSeconds: number; geometry: [number,number][]; steps: RouteStep[]; congestion: Congestion[] }
async function getJSON(url: URL, signal: AbortSignal, request: typeof fetch): Promise<any> {
  const response = await request(url.toString(), { signal });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Mapbox rejected the public token.');
    if (response.status === 429) throw new Error('Mapbox rate limit reached.');
    throw new Error('Mapbox request failed (' + response.status + ').');
  }
  return response.json();
}
// Haversine distance score: preserves distance order without converting to meters.
function distanceScore(a: Coordinate, b: Coordinate): number {
  const r = Math.PI / 180, lat = (b.lat - a.lat) * r, lng = (b.lng - a.lng) * r;
  return Math.sin(lat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(lng / 2) ** 2;
}
export async function findDestination(query: string, token: string, origin: Coordinate, signal: AbortSignal, request: typeof fetch = fetch): Promise<Destination[]> {
  if (!query.trim() || !token.startsWith('pk.')) throw new Error('Destination search is not configured.');
  if (![origin.lat, origin.lng].every(Number.isFinite) || Math.abs(origin.lat) > 90 || Math.abs(origin.lng) > 180)
    throw new Error('Your GPS location is unavailable.');
  const url = new URL('https://api.mapbox.com/search/searchbox/v1/forward');
  for (const [key, value] of Object.entries({q:query.trim().slice(0,256), access_token:token, limit:'10', proximity:origin.lng+','+origin.lat}))
    url.searchParams.set(key, value);
  const json = await getJSON(url, signal, request);
  const results = (Array.isArray(json.features) ? json.features : []).flatMap((f: any) => {
    const [lng, lat] = f?.geometry?.coordinates ?? [];
    if (![lng, lat].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
    const p = f.properties ?? {}, name = String(p.name_preferred || p.name || 'Destination');
    const address = String(p.full_address || p.place_formatted || '');
    const label = p.feature_type === 'address' ? address || name : [name, address].filter(Boolean).join(', ');
    return [{type:p.feature_type, place:{lng, lat, label:label.slice(0,180)} as Destination}];
  });
  // Sort businesses closest-first without breaking relevance order for specific address searches.
  const pois = results.filter(r => r.type === 'poi').sort((a, b) => distanceScore(origin,a.place) - distanceScore(origin,b.place));
  return results.map(r => (r.type === 'poi' ? pois.shift()! : r).place);
}
export async function drivingRoutes(origin: Coordinate, destination: Coordinate, token: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<PreviewRoute[]> {
  if (!token.startsWith('pk.')) throw new Error('Mapbox public token not configured.');
  const coords = [origin,destination].map(p => p.lng + ',' + p.lat).join(';');
  const url = new URL('https://api.mapbox.com/directions/v5/mapbox/driving-traffic/' + coords);
  url.searchParams.set('access_token', token);
  url.searchParams.set('alternatives', 'true');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('overview', 'full');
  url.searchParams.set('steps', 'true');
  url.searchParams.set('annotations', 'congestion');
  const json = await getJSON(url, signal, request);
  if (json.code !== 'Ok') throw new Error('Mapbox could not find a drivable route.');
  return (Array.isArray(json.routes) ? json.routes : []).flatMap((route: any) => {
    const p = route?.geometry?.coordinates;
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) return [];
    if (!p.every((a: unknown) => Array.isArray(a) && a.length >= 2 && a.slice(0,2).every((n: unknown) => typeof n === 'number' && Number.isFinite(n)))) return [];
    const steps: RouteStep[] = (Array.isArray(route.legs) ? route.legs : []).flatMap((leg: any) => Array.isArray(leg.steps) ? leg.steps : []).flatMap((s: any) => {
      const location = s?.maneuver?.location;
      if (!Array.isArray(location) || location.length < 2 || !location.slice(0,2).every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) return [];
      return [{ instruction: String(s.maneuver.instruction || 'Continue'), location: [location[0], location[1]] as [number,number], distanceMeters: Number(s.distance) || 0 }];
    });
    const raw = (Array.isArray(route.legs) ? route.legs : []).flatMap((l: any) => Array.isArray(l.annotation?.congestion) ? l.annotation.congestion : []);
    const congestion: Congestion[] = raw.length === p.length-1 ? raw.map((v: unknown) => ['low','moderate','heavy','severe'].includes(String(v)) ? v as Congestion : 'unknown') : [];
    return [{ distanceMeters: route.distance, durationSeconds: route.duration, geometry: p as [number,number][], steps, congestion }];
  });
}
