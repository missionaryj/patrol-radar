/**
 * Optional 3D view (MapLibre GL, lazy-loaded so the 2D app never downloads it). Leaflet stays the source of truth for
 * pins and follow-me; this view mirrors them. Display only: nothing here is stored or sent.
 */
import { style3d, MAX_PITCH, PITCH_3D } from './palette';
import { headingStep, patrolZoom, MAX_PATROL_ZOOM } from './patrolDriving';
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
  private patrolMoving = false; private patrolBearing?: number;
  private navigationCoords: [number,number][] = [];
  private navigationPlaces: {lat:number;lng:number;label:string}[] = [];
  private driving = false;
  setDrivingMode(on:boolean) {
    if(this.driving===on)return;
    this.driving=on;
    if(on)this.setPatrolMoving(false);
    this.map?.jumpTo({pitch:on?MAX_PITCH:PITCH_3D,zoom:on?Math.max(17,this.map.getZoom()):this.map.getZoom(),
      padding:{top:0,bottom:0,left:0,right:0}});
  }
  setNavigationPlaces(places:{lat:number;lng:number;label:string}[]) { this.navigationPlaces=places.slice(0,16);this.applyNavigationPlaces(); }
  private applyNavigationPlaces(){
    if(!this.map || !this.ready)return;
    const data={type:'FeatureCollection' as const,features:this.navigationPlaces.map(p=>({type:'Feature' as const,properties:{},geometry:{type:'Point' as const,coordinates:[p.lng,p.lat]}}))};
    const source=this.map.getSource('saved-navigation-places') as import('maplibre-gl').GeoJSONSource|undefined;
    if(source)source.setData(data);else{
      this.map.addSource('saved-navigation-places',{type:'geojson',data});
      this.map.addLayer({id:'saved-navigation-dots',type:'circle',source:'saved-navigation-places',paint:{'circle-color':'#f34b5d','circle-radius':7,'circle-stroke-color':'#fff','circle-stroke-width':2}});
    }
  }
  private navigationCongestion: string[] = [];
  setNavigationRoute(coords: [number,number][], congestion: string[] = []) {
    this.navigationCoords = coords; this.navigationCongestion = congestion; this.applyNavigationRoute();
  }
  private applyNavigationRoute() {
    if (!this.map || !this.ready) return;
    const features: {type:'Feature';properties:{color:string};geometry:{type:'LineString';coordinates:[number,number][]}}[] = [];
    const coords = this.navigationCoords, traffic = this.navigationCongestion;
    const colors: Record<string,string> = {low:'#21bd6b',moderate:'#eabf30',heavy:'#fb8541',severe:'#ed4047'};
    if(coords.length >= 2) {
      if(traffic.length === coords.length - 1) {
        let start=0;
        for(let i=1;i<=traffic.length;i++) {
          if(i===traffic.length || traffic[i]!==traffic[start]) {
            features.push({type:'Feature',properties:{color:colors[traffic[start]] || '#347CFF'},geometry:{type:'LineString',coordinates:coords.slice(start,i+1)}});
            start=i;
          }
        }
      } else features.push({type:'Feature',properties:{color:'#347CFF'},geometry:{type:'LineString',coordinates:coords}});
    }
    const data = {type:'FeatureCollection' as const, features};
    const src = this.map.getSource('navigation-route') as import('maplibre-gl').GeoJSONSource | undefined;
    if(src) src.setData(data); else {
      this.map.addSource('navigation-route', {type:'geojson',data});
      this.map.addLayer({id:'navigation-route-line',type:'line',source:'navigation-route',
        paint:{'line-color':['get','color'],'line-width':7,'line-opacity':.95}}, this.map.getLayer('pts') ? 'pts' : undefined);
    }
  }
  private heatFC: { type: 'FeatureCollection'; features: any[] } = { type: 'FeatureCollection', features: [] };
  constructor(private el: HTMLElement, private theme: 'light' | 'dark', private onUserPan: () => void, private onFailure: () => void = () => {}) {}
  onMoveEnd?: () => void;
  /** Driving presentation only: do not alter scan data or GPS session. */
  setPatrolMoving(on: boolean) {
    if (this.patrolMoving === on) return;
    this.patrolMoving = on;
    if (!on) { this.patrolBearing = undefined; }
    if (!this.map || !this.ready) return;
    // Follow updates use jumpTo, which cancels easeTo animations; reset the unsafe zoom atomically.
    if (on) this.map.jumpTo({ zoom: patrolZoom(this.map.getZoom(), true), pitch: Math.min(this.map.getPitch(), 48) });
    this.map.setPaintProperty('acc', 'fill-opacity', on ? 0.025 : 0.12);
  }
  bounds() { return this.map?.getBounds(); }
  get active() { return !!this.map; }
  async open(center: { lat: number; lng: number }, zoom: number) {
    if (this.map) return;
    const generation = ++this.generation;
    this.ml ??= (await import('maplibre-gl')).default as unknown as ML;
    await import('maplibre-gl/dist/maplibre-gl.css');
    if (generation !== this.generation) return;
    this.el.hidden = false;
    // Keep the first visible map frame fully initialized; MapView suppresses 2D while loading.
    this.el.style.visibility = 'hidden';
    let map: import('maplibre-gl').Map;
    try { map = new this.ml.Map({ container: this.el, style: style3d(this.theme), center: [center.lng, center.lat], zoom: patrolZoom(zoom, this.patrolMoving), maxZoom: MAX_PATROL_ZOOM, pitch: this.driving ? MAX_PITCH : this.patrolMoving ? 48 : PITCH_3D, maxPitch: MAX_PITCH,
      attributionControl: { compact: true }, antialias: false, fadeDuration: 0, pixelRatio: Math.min(2, window.devicePixelRatio || 1) } as any);
    } catch (e) { this.el.hidden = true; this.el.style.visibility = ''; throw e; }
    this.map = map;
    map.on('dragstart', () => this.onUserPan());
    map.on('moveend', () => this.onMoveEnd?.());
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
      map.addLayer({ id: 'acc', type: 'fill', source: 'acc', paint: { 'fill-color': '#2a7fff', 'fill-opacity': this.patrolMoving ? 0.025 : 0.12 } });
      map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-color': '#2a7fff', 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'viewport' } });
      this.ready = true;
      // GPS may start while 3D is loading; apply the moving camera once the style exists.
      if (this.patrolMoving) map.jumpTo({ zoom: patrolZoom(map.getZoom(), true), pitch: Math.min(map.getPitch(), 48) });
      if (this.pending) this.update(this.pending); this.applyHeat(); this.applyNavigationRoute(); this.applyNavigationPlaces();
      this.el.style.visibility = ''; finish();
      } catch (e) { finish(e instanceof Error ? e : new Error('3D map initialization failed')); }
    });
    });
  }
  close() { ++this.generation; this.cancelOpen?.(); this.map?.remove(); this.map = undefined; this.ready = false; this.el.hidden = true; this.el.style.visibility = ''; }
  /** Follow the smoothed position. Rotate only for reliable driving headings; never for walking GPS drift. */
  follow(lat: number, lng: number, zoom?: number, heading?: number) {
    if (!this.map) return;
    if (this.patrolMoving) this.patrolBearing = headingStep(this.patrolBearing, heading);
    const bearing = this.driving ? heading : this.patrolMoving ? this.patrolBearing : undefined;
    this.map.jumpTo({
      center: [lng, lat],
      ...(zoom === undefined ? {} : { zoom: patrolZoom(zoom, this.patrolMoving) }),
      ...(bearing === undefined ? {} : { bearing }),
      // Higher top inset anchors the vehicle around 70% down the screen, leaving the road ahead visible.
      ...(this.driving ? { padding:{top:Math.round((this.el.clientHeight || 0) * 0.4),bottom:0,left:0,right:0} } : {}),
    });
  }
  view() { const m = this.map; if (!m) return undefined; const c = m.getCenter(); return { lat: c.lat, lng: c.lng, zoom: m.getZoom() }; }
  setPitch(p: number) { this.map?.easeTo({ pitch: p, duration: 300 }); }
  get pitch() { return this.map?.getPitch() ?? 0; }
  /** Visual-only historical stop shading: color and opacity, never tappable. */
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
    } else src.setData?.(this.heatFC);
  }
  update(m: Mirror) {
    if (!this.map || !this.ready) { this.pending = m; return; }
    const g = toGeoJSON(m);
    for (const k of ['pts', 'polys', 'me', 'acc'] as const) (this.map.getSource(k) as any)?.setData(g[k]);
  }
  resize() { this.map?.resize(); }
}
