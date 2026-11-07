/**
 * Optional 3D view (MapLibre GL, lazy-loaded so the 2D app never downloads it). Leaflet stays the source of truth for
 * pins and follow-me; this view mirrors them. Display only: nothing here is stored or sent.
 */
import { style3d, MAX_PITCH, PITCH_3D } from './palette';
type ML = typeof import('maplibre-gl');
export interface Pin3D { lat: number; lng: number; color: string; r: number; ring?: number; kind: 'dot' | 'ring' | 'cell' | 'veh'; html?: string }
export interface Mirror { pins: Pin3D[]; me?: { lat: number; lng: number; acc: number } }

/** Circle polygon in metres (rings and the accuracy circle), 24 segments is plenty at street zoom. */
export function circlePoly(lat: number, lng: number, rM: number, n = 24): number[][] {
  const out: number[][] = []; const dLat = rM / 111_320, dLng = rM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return out;
}
export function toGeoJSON(m: Mirror) {
  const pts: any[] = [], polys: any[] = [];
  for (const p of m.pins) {
    if (p.kind === 'ring' || p.kind === 'cell') polys.push({ type: 'Feature', properties: { color: p.color, cell: p.kind === 'cell' }, geometry: { type: 'Polygon', coordinates: [circlePoly(p.lat, p.lng, p.ring ?? 30)] } });
    else pts.push({ type: 'Feature', properties: { color: p.color, r: p.r, veh: p.kind === 'veh', ...(p.html ? { html: p.html } : {}) }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
  }
  const me = m.me ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [m.me.lng, m.me.lat] } }] : [];
  const acc = m.me ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePoly(m.me.lat, m.me.lng, Math.max(3, m.me.acc))] } }] : [];
  const fc = (f: any[]) => ({ type: 'FeatureCollection', features: f });
  return { pts: fc(pts), polys: fc(polys), me: fc(me), acc: fc(acc) };
}

export class Map3D {
  private ml?: ML; private map?: import('maplibre-gl').Map; private ready = false; private pending?: Mirror;
  private generation = 0; private cancelOpen?: () => void;
  private heatFC: { type: 'FeatureCollection'; features: any[] } = { type: 'FeatureCollection', features: [] };
  constructor(private el: HTMLElement, private theme: 'light' | 'dark', private onUserPan: () => void, private onFailure: () => void = () => {}) {}
  get active() { return !!this.map; }
  async open(center: { lat: number; lng: number }, zoom: number) {
    if (this.map) return;
    const generation = ++this.generation;
    this.ml ??= (await import('maplibre-gl')).default as unknown as ML;
    await import('maplibre-gl/dist/maplibre-gl.css');
    if (generation !== this.generation) return;
    this.el.hidden = false;
    // MapLibre needs a laid-out container, but must not obscure the 2D map until it is ready.
    this.el.style.visibility = 'hidden';
    let map: import('maplibre-gl').Map;
    try { map = new this.ml.Map({ container: this.el, style: style3d(this.theme), center: [center.lng, center.lat], zoom: Math.max(zoom, 16), pitch: PITCH_3D, maxPitch: MAX_PITCH,
      attributionControl: { compact: true }, antialias: false, fadeDuration: 0, pixelRatio: Math.min(2, window.devicePixelRatio || 1) } as any);
    } catch (e) { this.el.hidden = true; this.el.style.visibility = ''; throw e; }
    this.map = map;
    map.on('dragstart', () => this.onUserPan());
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return; settled = true; clearTimeout(timer); this.cancelOpen = undefined;
        if (error) { this.close(); reject(error); } else resolve();
      };
      const timer = setTimeout(() => finish(new Error('3D map did not load')), 15000);
      this.cancelOpen = () => finish();
      map.on('webglcontextlost', () => {
        if (generation !== this.generation) return;
        if (!settled) finish(new Error('3D map graphics context lost'));
        else { this.close(); this.onFailure(); }
      });
      map.on('load', () => {
      if (generation !== this.generation) return;
      try {
      for (const id of ['acc', 'polys', 'pts', 'me']) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'polys-fill', type: 'fill', source: 'polys', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'cell'], 0.25, 0.1] } });
      map.addLayer({ id: 'polys-line', type: 'line', source: 'polys', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'pts', type: 'circle', source: 'pts', paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'r'], 'circle-stroke-color': '#111', 'circle-stroke-width': ['case', ['get', 'veh'], 3, 1], 'circle-pitch-alignment': 'viewport' } });
      // Tap a mapped traffic camera in 3D: same popup as 2D.
      map.on('click', 'pts', e => { const f = e.features?.[0]; const h = f?.properties?.html; if (h && this.ml) new this.ml.Popup({ closeButton: true, maxWidth: '260px' }).setLngLat((f!.geometry as any).coordinates).setHTML(h).addTo(map); });
      // Own location: drawn last so it stays on top of buildings and pins.
      map.addLayer({ id: 'acc', type: 'fill', source: 'acc', paint: { 'fill-color': '#2a7fff', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-color': '#2a7fff', 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'viewport' } });
      this.ready = true; if (this.pending) this.update(this.pending); this.applyHeat();
      this.el.style.visibility = ''; finish();
      } catch (e) { finish(e instanceof Error ? e : new Error('3D map initialization failed')); }
    });
    });
  }
  close() { ++this.generation; this.cancelOpen?.(); this.map?.remove(); this.map = undefined; this.ready = false; this.el.hidden = true; this.el.style.visibility = ''; }
  /** Follow-me: keep pitch/bearing the user chose, move the centre only. */
  follow(lat: number, lng: number) { this.map?.jumpTo({ center: [lng, lat] }); }
  view() { const m = this.map; if (!m) return undefined; const c = m.getCenter(); return { lat: c.lat, lng: c.lng, zoom: m.getZoom() }; }
  setPitch(p: number) { this.map?.easeTo({ pitch: p, duration: 300 }); }
  get pitch() { return this.map?.getPitch() ?? 0; }
  /** Historical stop shading. Flat properties only: color, opacity, html. Drawn under the location dot. */
  setHeat(fc: { type: 'FeatureCollection'; features: any[] }) {
    this.heatFC = fc;
    if (!this.map || !this.ready) return;
    this.applyHeat();
  }
  private applyHeat() {
    const map = this.map; if (!map) return;
    const src = map.getSource('heat') as { setData?: (d: unknown) => void } | undefined;
    if (!src) {
      map.addSource('heat', { type: 'geojson', data: this.heatFC });
      const before = map.getLayer('pts') ? 'pts' : undefined;
      map.addLayer({ id: 'heat-fill', type: 'fill', source: 'heat', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] } }, before);
      map.on('click', 'heat-fill', (e: any) => {
        const html = e.features?.[0]?.properties?.html;
        if (html && this.ml) new this.ml.Popup({ closeButton: true, maxWidth: '280px' }).setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on('mouseenter', 'heat-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'heat-fill', () => { map.getCanvas().style.cursor = ''; });
    } else src.setData?.(this.heatFC);
  }
  update(m: Mirror) {
    if (!this.map || !this.ready) { this.pending = m; return; }
    const g = toGeoJSON(m);
    for (const k of ['pts', 'polys', 'me', 'acc'] as const) (this.map.getSource(k) as any)?.setData(g[k]);
  }
  resize() { this.map?.resize(); }
}
