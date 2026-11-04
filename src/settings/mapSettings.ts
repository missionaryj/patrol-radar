/** Shared wiring for travel mode, 3D view (v1 + v2). Only the choices are stored locally. */
import { loadTravelMode, setTravelMode, type TravelMode } from './travelMode';
import type { MapView } from '../map/mapView';
export const MAP3D_KEY = 'pr.map3d';
/** 3D buildings are on by default; only an explicit saved '0' turns them off. */
export const map3dDefault = (saved: string | null) => saved !== '0';
export function mountMapSettings(map: MapView, onTravel?: (m: TravelMode) => void) {
  const tm = document.getElementById('travelmode') as HTMLSelectElement | null;
  const mode = loadTravelMode(); if (tm) { tm.value = mode; tm.onchange = () => { setTravelMode(tm.value as TravelMode); onTravel?.(tm.value as TravelMode); }; }
  const cb = document.getElementById('map3d') as HTMLInputElement | null, pitch = document.getElementById('pitch') as HTMLButtonElement | null;
  const set3d = async (on: boolean) => {
    try { localStorage.setItem(MAP3D_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    if (pitch) pitch.hidden = !on;
    try { await map.set3D(on); } catch (e) { console.warn('3D view failed', e); if (cb) cb.checked = false; if (pitch) pitch.hidden = true; await map.set3D(false); }
  };
  if (pitch) pitch.onclick = () => map.togglePitch();
  let on = true; try { on = map3dDefault(localStorage.getItem(MAP3D_KEY)); } catch { /* ignore */ }
  if (cb) { cb.checked = on; cb.onchange = () => void set3d(cb.checked); } if (on) void set3d(true);
}
