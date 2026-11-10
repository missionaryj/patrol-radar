import type { Destination } from './mapboxPreview';

const RECENT_KEY = 'pr.navigation.recents.v1';
const SAVED_KEY = 'pr.navigation.saved.v1';

function validPlace(value: unknown): value is Destination {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return typeof p.label === 'string' && p.label.trim().length > 0 && p.label.length <= 180 &&
    typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
    typeof p.lng === 'number' && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;
}
export function readPlaces(raw: string | null, max = 10): Destination[] {
  if (!raw || raw.length > 10000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(validPlace).slice(0, max).map(p => ({lat:p.lat,lng:p.lng,label:p.label.trim()})) : [];
  } catch { return []; }
}
export function samePlace(a: Destination, b: Destination): boolean {
  return Math.abs(a.lat - b.lat) < 0.00002 && Math.abs(a.lng - b.lng) < 0.00002;
}
export function putPlace(list: Destination[], place: Destination, max = 10): Destination[] {
  if (!validPlace(place)) return list;
  return [{lat:place.lat,lng:place.lng,label:place.label}, ...list.filter(p => !samePlace(p,place))].slice(0,max);
}
function load(key: string, max: number): Destination[] {
  try { return readPlaces(localStorage.getItem(key),max); } catch { return []; }
}
function store(key: string, places: Destination[]) {
  try { localStorage.setItem(key, JSON.stringify(places)); } catch { /* storage may be restricted */ }
}
/** Only places explicitly chosen by the user are remembered locally. No search query is stored. */
export const NavigationPlaces = {
  recents: () => load(RECENT_KEY,8),
  saved: () => load(SAVED_KEY,16),
  remember(place: Destination) { store(RECENT_KEY,putPlace(load(RECENT_KEY,8),place,8)); },
  toggleSaved(place: Destination): boolean {
    const list=load(SAVED_KEY,16), exists=list.some(p=>samePlace(p,place));
    store(SAVED_KEY,exists?list.filter(p=>!samePlace(p,place)):putPlace(list,place,16));
    return !exists;
  },
  clearRecents() { store(RECENT_KEY,[]); }
};
