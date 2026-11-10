/** Mapbox destination search and route preview. Provider search results are temporary; check Mapbox's storage terms before persisting them. */
export interface Coordinate { lat: number; lng: number }
export interface Destination extends Coordinate { label: string; name?: string; address?: string; distanceMeters?: number }
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
/** Straight-line proximity is for ordering search matches, not an estimate of driving distance. */
function distanceMetersBetween(origin: Coordinate, destination: Coordinate): number {
  const radians = Math.PI / 180;
  const a = origin.lat * radians, b = destination.lat * radians;
  const deltaLat = (destination.lat - origin.lat) * radians;
  const deltaLng = (destination.lng - origin.lng) * radians;
  const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(deltaLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}
export async function findDestination(query: string, token: string, origin: Coordinate, signal: AbortSignal, request: typeof fetch = fetch): Promise<Destination[]> {
  if (!query.trim() || !token.startsWith('pk.')) throw new Error('Destination search is not configured.');
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng) || Math.abs(origin.lat) > 90 || Math.abs(origin.lng) > 180)
    throw new Error('Your GPS location is unavailable.');
  // Search Box supports POIs (restaurants, shops, landmarks) and addresses; Geocoding v6 does not support POIs.
  // Use a one-off request only when Search is pressed; no keystroke billing or background queries.
  const url = new URL('https://api.mapbox.com/search/searchbox/v1/forward');
  url.searchParams.set('q', query.trim().slice(0, 256));
  url.searchParams.set('access_token', token);
  url.searchParams.set('limit', '10');
  url.searchParams.set('proximity', origin.lng + ',' + origin.lat);
  const json = await getJSON(url, signal, request);
  const features: any[] = Array.isArray(json.features) ? json.features : [];
  const results: { destination: Destination; type: string }[] = features.flatMap((feature: any) => {
    const p = feature?.geometry?.coordinates;
    if (!Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) return [];
    if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return [];
    const properties = feature?.properties ?? {};
    const type = String(properties.feature_type ?? '');
    const name = String(properties.name_preferred || properties.name || '').trim();
    const fullAddress = String(properties.full_address || '').trim();
    const place = String(properties.place_formatted || '').trim();
    const address = fullAddress || place || String(properties.address || '').trim();
    const label = (type === 'address' ? fullAddress || [name, place].filter(Boolean).join(', ') :
      [name, address].filter(Boolean).join(', ')) || 'Destination';
    const destination: Destination = { lng: p[0], lat: p[1], label: label.slice(0, 180),
      name: name || undefined, address: address || undefined,
      distanceMeters: distanceMetersBetween(origin, { lng: p[0], lat: p[1] }) };
    return [{ destination, type }];
  });
  // Preserve Mapbox's relevance ordering for addresses and cities. For businesses/POIs,
  // sort the POI slots by proximity so a nearby McDonald's precedes one across the country.
  const nearbyPois = results.filter(result => result.type === 'poi')
    .sort((a, b) => a.destination.distanceMeters! - b.destination.distanceMeters!);
  let poiIndex = 0;
  return results.map(result => (result.type === 'poi' ? nearbyPois[poiIndex++] : result).destination);
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
