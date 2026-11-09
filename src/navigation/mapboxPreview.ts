/** Real Mapbox route PREVIEW, not active turn-by-turn guidance. Do not persist temporary geocoding results. */
export interface Coordinate { lat: number; lng: number }
export interface Destination extends Coordinate { label: string }
export interface PreviewRoute { distanceMeters: number; durationSeconds: number; geometry: [number,number][] }
async function getJSON(url: URL, signal: AbortSignal, request: typeof fetch): Promise<any> {
  const response = await request(url.toString(), { signal });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Mapbox rejected the public token.');
    if (response.status === 429) throw new Error('Mapbox rate limit reached.');
    throw new Error('Mapbox request failed (' + response.status + ').');
  }
  return response.json();
}
export async function findDestination(query: string, token: string, origin: Coordinate, signal: AbortSignal, request: typeof fetch = fetch): Promise<Destination[]> {
  if (!query.trim() || !token.startsWith('pk.')) throw new Error('Destination search is not configured.');
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', query.trim().slice(0,256));
  url.searchParams.set('access_token', token);
  url.searchParams.set('limit', '3');
  url.searchParams.set('autocomplete', 'false');
  url.searchParams.set('proximity', origin.lng + ',' + origin.lat);
  const json = await getJSON(url, signal, request);
  return (Array.isArray(json.features) ? json.features : []).flatMap((f: any) => {
    const p = f?.geometry?.coordinates;
    if (!Array.isArray(p) || p.length < 2 || !p.slice(0,2).every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) return [];
    return [{ lng: p[0], lat: p[1], label: String(f.properties?.full_address || f.properties?.name_preferred || f.properties?.name || 'Destination') }];
  });
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
  const json = await getJSON(url, signal, request);
  if (json.code !== 'Ok') throw new Error('Mapbox could not find a drivable route.');
  return (Array.isArray(json.routes) ? json.routes : []).flatMap((route: any) => {
    const p = route?.geometry?.coordinates;
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) return [];
    if (!p.every((a: unknown) => Array.isArray(a) && a.length >= 2 && a.slice(0,2).every((n: unknown) => typeof n === 'number' && Number.isFinite(n)))) return [];
    return [{ distanceMeters: route.distance, durationSeconds: route.duration, geometry: p as [number,number][] }];
  });
}
