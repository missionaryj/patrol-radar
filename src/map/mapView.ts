import { InitialMapView } from './startup';
import { Localizer, type Estimate } from '../fusion/localize';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Report } from '../reports/types';
import type { CrowdCell } from '../crowd/protocol';
import { type LiveDevice, bandRadius, WIFI_COLOR, offsetFor, applyOffset, opacityFor, LiveAnchors } from './liveDevices';
import type { Vehicle } from '../fusion/vehicles';
import { VEHICLE_EVIDENCE_LINE, WIFI_EVIDENCE_LINE } from '../wifi/identity';
import { TTL_MS } from '../reports/localStore';
import { FollowController } from './follow';
import { SmoothLocation } from './smoothFollow';
import { mountLegend } from './legend';
import { RASTER_2D, PITCH_3D } from './palette';
import { Map3D, type Pin3D } from './map3d';
import { type TcIndex, type TcRow, type TcType, TC_ATTRIBUTION, TC_MIN_ZOOM, TC_META, tcInBounds, tcIcon, tcPopup } from './trafficCamLayer';
import { type HeatCell, type HeatFilter, type StopHeatIndex, HEAT_CELL_CAP, HEAT_GRID_MIN_ZOOM, OPEN_FILTER, STOP_HEAT_ATTRIBUTION, countBuckets, heatPaint, heatTilesFor } from './stopHeatLayer';
import { type FlockCollection, type FlockIndex, FLOCK_ATTRIBUTION, FLOCK_MIN_ZOOM, flockInBounds, tilesFor } from './flockLayer';

/** Cap on live dots drawn (police matches first, then strongest RSSI). See scripts/stress/map.html. */
export const MAX_LIVE_DOTS = 150;
export interface MapViewOptions { dark?: boolean; legend?: boolean; layersControl?: boolean; zoomControl?: boolean; waitForLocation?: boolean; initial3D?: boolean; }
export class MapView {
  private map: L.Map;
  private raster: L.TileLayer;
  private wants3d = false;
  get wants3D() { return this.wants3d; }
  onPresentationChange?: (state: 'loading3d' | 'ready' | 'fallback') => void;
  /** True once setView has run. Leaflet throws if a tile layer is added before that. */
  private mapHasView = false;
  private showBasemap = false;
  private present2D(show: boolean) {
    this.showBasemap = show;
    this.map.getPane('mapPane')!.style.visibility = show ? '' : 'hidden';
    if (show) this.attachBasemap(); else this.raster.remove();
  }
  /** Street tiles stay off until there is a viewport, including when 2D is chosen during the location wait. */
  private attachBasemap() {
    if (!this.showBasemap || !this.mapHasView || this.map.hasLayer(this.raster)) return;
    this.raster.addTo(this.map);
  }
  private startup?: InitialMapView;
  private waitingForLocation = false;
  private viewReady: Promise<void> = Promise.resolve();
  private resolveView?: () => void;
  private view3dRequest = 0;
  get ready() { return this.viewReady; }
  /** Release the location wait on denial/unavailability; a later fix can still recenter. */
  locationUnavailable() { this.startup?.fallback(); }
  private m3: Map3D; private lastMirror = 0;
  private layer = L.layerGroup();
  readonly liveLayer = L.layerGroup();
  private navigationLine?: L.Polyline;
  private navigationPlaces = L.layerGroup();
  private driving = false;
  private drivingHeading?: number;
  /** Pins for places explicitly saved on this device. */
  setNavigationPlaces(places: Array<{lat:number;lng:number;label:string}>) {
    this.navigationPlaces.clearLayers();
    for (const place of places.slice(0,16)) {
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
      L.circleMarker([place.lat,place.lng],{radius:6,color:'#f87179',weight:2,fillColor:'#f34b5d',fillOpacity:0.95})
        .bindTooltip(place.label,{direction:'top'}).addTo(this.navigationPlaces);
    }
    this.m3.setNavigationPlaces(places);
  }
  /** The route is already selected: follow at driving zoom without refitting the whole trip every update. */
  setDrivingMode(on:boolean) {
    this.driving=on;
    this.m3.setDrivingMode(on);
    if(on){this.recenter();this.map.setZoom(Math.max(this.map.getZoom(),17));const c=this.smooth.disp;if(c)this.m3.follow(c.lat,c.lng,Math.max(this.map.getZoom(),17),this.drivingHeading);}
  }
  private trafficLines = L.layerGroup();
  /** Display-only route preview; active turn guidance belongs to the native SDK. */
  setNavigationRoute(coords: [number, number][], congestion: string[] = []) {
    this.navigationLine?.remove();
    this.trafficLines.clearLayers();
    if (coords.length < 2) { this.m3.setNavigationRoute([]); return; }
    this.navigationLine = L.polyline(coords.map(([lng,lat]) => [lat,lng] as [number,number]), { color: '#357FFF', weight: 7, opacity: 0.9, interactive: false }).addTo(this.map);
    if (congestion.length === coords.length - 1) {
      const colors: Record<string,string> = { low:'#21bd6b',moderate:'#eabf30',heavy:'#fb8541',severe:'#ed4047' };
      // Merge adjacent segments of equal congestion to prevent thousands of Leaflet layers.
      let start=0;
      for(let i=1;i<=congestion.length;i++) {
        if(i===congestion.length || congestion[i]!==congestion[start]) {
          const color=colors[congestion[start]];
          if(color) L.polyline(coords.slice(start,i+1).map(([lng,lat])=>[lat,lng] as [number,number]),{
            color,weight:8,opacity:.9,interactive:false
          }).addTo(this.trafficLines);
          start=i;
        }
      }
      this.trafficLines.addTo(this.map);
    }
    this.m3.setNavigationRoute(coords,congestion);
    if (!this.driving) this.map.fitBounds(this.navigationLine.getBounds(), { padding: [45,45] });
  }
  readonly crowdLayer = L.layerGroup();
  readonly flockLayer = L.layerGroup();
  readonly tcLayer = L.layerGroup();
  /** Historical stop counts (beats / ~150 m cells). Not mirrored into the 3D view: thousands of cells would cover the location dot and the live pins. */
  readonly heatLayer = L.layerGroup();
  readonly follow: FollowController;
  /** Called when follow-me pauses (manual pan) or resumes. */
  onFollowChange?: (following: boolean) => void;
  on3DFailure?: () => void;
  private flockIdx?: FlockIndex; private flockBase = ''; private flockTiles = new Map<string, Promise<FlockCollection>>(); private flockOn = false; private flockLoading?: Promise<void>; private flockDraw = 0;
  private flockRenderer = L.canvas({ padding: 0.3 });
  private tcIdx?: TcIndex; private tcBase = ''; private tcTiles = new Map<string, Promise<TcRow[]>>(); private tcOn = false; private tcLoading?: Promise<void>; private tcDraw = 0; private tcTimer?: number; private tcTypes?: Set<TcType>;
  private heatIdx?: StopHeatIndex; private heatBase = ''; private heatOn = false; private heatPreview = true; private heatFilter: HeatFilter = { ...OPEN_FILTER };
  private heatTiles = new Map<string, Promise<HeatCell[] | undefined>>(); private heatBeats: { features?: { geometry: { type: string; coordinates: number[][][] | number[][][][] }; properties: Record<string, any> }[] }[] = [];
  private heatLoading?: Promise<void>; private heatDraw = 0; private heatTimer?: number; private heatRenderer!: L.Renderer;
  /** Live dots/rings on one canvas: hundreds of SVG paths rebuilt per refresh janked the map (see scripts/stress). */
  private liveRenderer = L.canvas({ padding: 0.3 });
  constructor(el: HTMLElement, center: [number, number] = [41.88, -87.63], opts: MapViewOptions = {}) {
    this.map = L.map(el, { zoomControl: opts.zoomControl ?? true });
    this.waitingForLocation = !!opts.waitForLocation;
    if (this.waitingForLocation) this.viewReady = new Promise(resolve => { this.resolveView = resolve; });
    else { this.map.setView(center, 15); this.mapHasView = true; }
    // Cool-slate basemap (OSM tiles + CSS filter, no API key); .tiles-slate adds a slight blue-grey tint.
    this.raster = L.tileLayer(opts.dark ? RASTER_2D.dark : RASTER_2D.light, { maxZoom: 19, attribution: RASTER_2D.attribution, className: opts.dark ? 'tiles-slate-dark' : 'tiles-slate' });
    this.wants3d = !!opts.initial3D;
    this.present2D(!this.wants3d);
    const el3 = L.DomUtil.create('div', 'map3d', el); el3.hidden = true; L.DomEvent.disableClickPropagation(el3); L.DomEvent.disableScrollPropagation(el3);
    this.m3 = new Map3D(el3, opts.dark ? 'dark' : 'light', () => this.follow.userPanned(), () => { void this.set3D(false); this.on3DFailure?.(); this.onPresentationChange?.('fallback'); });
    this.m3.onMoveEnd = () => { if (this.flockOn) this.scheduleFlock(); };
    // Traffic cameras get their own pane above the overlay canvas (so they stay tappable); the own-location dot and its
    // accuracy circle sit in a still higher, click-through pane so nothing can ever cover them.
    this.map.createPane('tcPane').style.zIndex = '420';
    // Above the overlay canvases (they eat every click) and below traffic-camera pins and the location dot.
    // The pane itself ignores hits; only the polygon shapes are clickable, so flock dots stay tappable in the gaps.
    const heatPane = this.map.createPane('heatPane'); heatPane.style.zIndex = '410'; heatPane.style.pointerEvents = 'none';
    // Visual-only shading: never intercept pointer events intended for markers or the map.
    this.heatRenderer = L.svg({ pane: 'heatPane' });
    const mp = this.map.createPane('mePane'); mp.style.zIndex = '640'; mp.style.pointerEvents = 'none';
    this.layer.addTo(this.map); this.liveLayer.addTo(this.map); this.crowdLayer.addTo(this.map); this.navigationPlaces.addTo(this.map);
    if (opts.legend ?? true) this.addLegend();
    this.follow = new FollowController(true, f => this.onFollowChange?.(f));
    this.map.on('dragstart', () => this.follow.userPanned());
    // Follow-me moves the map every frame, so redraw Flock dots at most every ~400 ms instead of on every moveend.
    this.map.on('moveend', () => { if (this.flockOn) this.scheduleFlock();
      if (this.tcOn && this.tcTimer === undefined) this.tcTimer = window.setTimeout(() => { this.tcTimer = undefined; void this.drawTc(); }, 400);
      if (this.heatOn && this.heatTimer === undefined) this.heatTimer = window.setTimeout(() => { this.heatTimer = undefined; void this.drawHeat(); }, 400); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick(); });
    if (opts.layersControl ?? true) L.control.layers(undefined, { 'Flock camera (mapped)': this.flockLayer, 'Traffic cameras': this.tcLayer, 'Stop history': this.heatLayer, 'BLE detections': this.layer, 'Live devices (estimate)': this.liveLayer, 'Crowd (shared, delayed)': this.crowdLayer }).addTo(this.map);
    if (opts.waitForLocation) this.startup = new InitialMapView((lat, lng, zoom) => {
      this.waitingForLocation = false;
      this.map.setView([lat, lng], zoom, { animate: false });
      this.mapHasView = true;
      this.attachBasemap();
      this.resolveView?.();
    });
  }
  invalidate() { this.map.invalidateSize(); this.m3.resize(); }
  showCrowd(on: boolean) { if (on) this.crowdLayer.addTo(this.map); else this.crowdLayer.remove(); }
  /** Crowd cells: purple ~200 m squares; solid when confirmed (2+ reporters or high conf), faint dotted when single-reporter. */
  renderCrowd(cells: CrowdCell[], now = Date.now()) {
    this.crowdLayer.clearLayers(); queueMicrotask(() => { if (this.m3.active) this.mirror3d(); });
    for (const c of cells) {
      const d = 0.0009, f = c.confirmed;
      L.rectangle([[c.lat - d, c.lng - d * 1.3], [c.lat + d, c.lng + d * 1.3]], { color: '#b03cff', weight: f ? 2.5 : 1, dashArray: f ? undefined : '2 4', opacity: f ? 0.95 : 0.45, fillColor: '#b03cff', fillOpacity: f ? 0.32 : 0.08, className: 'crowd-pin' })
        .bindTooltip(f ? '👥' : '·', { permanent: true, direction: 'center', className: 'cell-icon' })
        .bindPopup(`👥 <b>${c.kind}</b> · ${f ? 'crowd confirmed' : 'single report'}<br>${c.reporters} reporter${c.reporters > 1 ? 's' : ''} · conf ${c.conf}<br>~${Math.round((now - c.last) / 60000)} min ago (≥12 min delay)<br><small>~200 m area, shared by other users</small>`)
        .addTo(this.crowdLayer);
    }
  }
  setCenter(lat: number, lng: number) { this.map.setView([lat, lng]); }
  /** Coarse cells, opacity decays linearly to 0 at TTL. */
  render(reports: Report[], now = Date.now()) {
    this.layer.clearLayers(); queueMicrotask(() => { if (this.m3.active) this.mirror3d(); });
    for (const r of reports) {
      const fade = Math.max(0, 1 - (now - r.timestamp) / TTL_MS);
      const wifi = r.radio === 'wifi' || r.label.endsWith('(Wi-Fi)');
      L.circle([r.lat, r.lng], { radius: 120, color: wifi ? WIFI_COLOR : '#e33', weight: wifi ? 4 : 3, dashArray: wifi ? '8 6' : undefined, fillOpacity: 0.35 * fade, opacity: fade })
        .bindPopup(`${wifi ? '📶 <b>Wi-Fi</b> · ' : ''}${r.label}<br>conf ${(r.confidence * 100).toFixed(0)}%<br>${Math.round((now - r.timestamp) / 60000)} min ago`)
        .addTo(this.layer);
    }
  }
  /** Closest-approach localisation (in memory only). Feed matched hits with observe(). */
  readonly loc = new Localizer();
  private meRenderer = L.svg({ pane: 'mePane' });
  private me?: L.CircleMarker; private meAcc?: L.Circle; private centered = false;
  private smooth = new SmoothLocation(); private raf?: number; private lastFrame = 0; private flockTimer?: number;
  /** Display-only "my location". Precise coords live only in these Leaflet layers and in memory, never stored or reported. */
  setUserLocation(lat: number, lng: number, accuracy: number, speed?: number | null, heading?: number | null, t = Date.now()) {
    this.startup?.locate(lat, lng);
    if(this.driving && heading != null && Number.isFinite(heading) && heading>=0 && (speed ?? 0)>1.5)this.drivingHeading=heading;
    const first = this.smooth.push({ lat, lng, acc: accuracy, t, speed, heading });
    this.loc.fix({ t, lat, lng, acc: accuracy, speed }); // in-memory track for closest-approach pins (never stored)
    if (!this.me) {
      this.meAcc = L.circle([lat, lng], { radius: accuracy, color: '#2a7fff', weight: 1, fillOpacity: 0.12, interactive: false, pane: 'mePane', renderer: this.meRenderer }).addTo(this.map);
      this.me = L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2a7fff', fillOpacity: 1, interactive: false, pane: 'mePane', renderer: this.meRenderer }).addTo(this.map);
    }
    if (first || !this.centered) { this.centered = true; this.map.setView([lat, lng], Math.max(this.map.getZoom(), 16), { animate: false }); this.m3.follow(lat, lng, this.map.getZoom()); }
    this.kick();
  }
  /** Start the frame loop if it isn't running. It stops itself once the dot settles (or the page is hidden) to save battery. */
  private kick() {
    if (this.raf !== undefined || !this.me || document.hidden) return;
    this.lastFrame = performance.now(); this.raf = requestAnimationFrame(this.frame);
  }
  private frame = (ts: number) => {
    this.raf = undefined;
    const dt = Math.min(100, ts - this.lastFrame); this.lastFrame = ts;
    const more = this.smooth.tick(Date.now(), dt); const d = this.smooth.disp!;
    this.me!.setLatLng([d.lat, d.lng]); this.meAcc!.setLatLng([d.lat, d.lng]).setRadius(this.smooth.acc);
    this.moveRel(); // unknown-device dots + rings ride with the user dot (were redrawn only on the ~3/s data tick)
    if (this.follow.onFix()) { this.map.setView([d.lat, d.lng], this.map.getZoom(), { animate: false, noMoveStart: true } as L.ZoomPanOptions); this.m3.follow(d.lat, d.lng, this.driving ? Math.max(17,this.map.getZoom()) : undefined, this.driving ? this.drivingHeading : undefined); }
    if (this.m3.active && ts - this.lastMirror > 200) this.mirror3d();
    if (more && !document.hidden) this.raf = requestAnimationFrame(this.frame);
  };
  /** Recenter and resume follow-me. */
  recenter(): boolean { this.follow.resume(); if (!this.me) return false; const c = this.smooth.disp ?? this.me.getLatLng(); this.map.setView(c, Math.max(this.map.getZoom(), 15)); this.m3.follow(c.lat, c.lng, this.driving ? Math.max(17,this.map.getZoom()) : undefined, this.driving ? this.drivingHeading : undefined); this.kick(); return true; }
  // ---- 3D view (extruded buildings). Leaflet keeps all state; the 3D map mirrors pins + own dot. ----
  get is3D() { return this.m3.active; }
  async set3D(on: boolean) {
    const request = ++this.view3dRequest;
    this.wants3d = on;
    this.present2D(!on);
    if (!on) {
      const v = this.m3.view(); this.m3.close();
      if (this.flockOn) this.scheduleFlock();
      if (v && !this.follow.following) this.map.setView([v.lat, v.lng], Math.round(v.zoom));
      await this.viewReady;
      if (request === this.view3dRequest) this.onPresentationChange?.('ready');
      return;
    }
    this.onPresentationChange?.('loading3d');
    await this.viewReady;
    if (request !== this.view3dRequest) return;
    try {
      const c = this.smooth.disp ?? this.map.getCenter();
      await this.m3.open({ lat: c.lat, lng: c.lng }, this.map.getZoom());
      if (request !== this.view3dRequest) return;
      const latest = this.smooth.disp;
      if (latest && this.follow.following) this.m3.follow(latest.lat, latest.lng, this.map.getZoom());
      this.mirror3d(); this.kick();
      this.onPresentationChange?.('ready');
    } catch {
      if (request !== this.view3dRequest) return;
      await this.set3D(false);
      this.on3DFailure?.();
      this.onPresentationChange?.('fallback');
      return;
    }
    // Optional camera data must not delay the first usable 3D view or force a fallback.
    if (this.flockOn) await this.drawFlock().catch(e => console.warn('Flock layer unavailable', e));
  }
  /** Tilt between flat and 3D while the 3D view is open. */
  togglePitch() { if (this.m3.active) this.m3.setPitch(this.m3.pitch > 5 ? 0 : PITCH_3D); }
  /** Copy what Leaflet is drawing (coarse cells, live pins/rings, crowd cells, own dot) into the 3D view. */
  private mirror3d() {
    this.lastMirror = performance.now(); if (!this.m3.active) return;
    const pins: Pin3D[] = [];
    const walk = (g: L.LayerGroup, cell = false) => g.eachLayer(l => {
      const o = (l as any).options ?? {}; const color = o.fillColor ?? o.color ?? '#e33';
      if (l instanceof L.Rectangle) { const c = l.getBounds().getCenter(); pins.push({ lat: c.lat, lng: c.lng, color, r: 0, ring: 100, kind: 'cell' }); }
      else if (l instanceof L.Circle) { const c = l.getLatLng(); pins.push({ lat: c.lat, lng: c.lng, color: o.color ?? color, r: 0, ring: l.getRadius(), kind: cell ? 'cell' : 'ring' }); }
      else if (l instanceof L.CircleMarker) { const c = l.getLatLng(); pins.push({ lat: c.lat, lng: c.lng, color, r: l.getRadius(), kind: 'dot' }); }
      else if (l instanceof L.Marker && (l.options.icon?.options as any)?.className === 'veh-pin') { const c = l.getLatLng(); pins.push({ lat: c.lat, lng: c.lng, color: '#ff1744', r: 10, kind: 'veh' }); }
    });
    walk(this.layer, true); walk(this.crowdLayer, true); walk(this.liveLayer);
    if (this.tcOn) this.tcLayer.eachLayer(l => { const t = (l as any).tcType as TcType | undefined; if (t && l instanceof L.Marker) { const c = l.getLatLng(); pins.push({ lat: c.lat, lng: c.lng, color: TC_META[t].color, r: 6, kind: 'dot', html: (l as any).tcHtml }); } });
    if (this.flockOn) this.flockLayer.eachLayer(l => {
      if (l instanceof L.CircleMarker) {
        const c = l.getLatLng(); const html = l.getPopup()?.getContent();
        pins.push({ lat: c.lat, lng: c.lng, color: '#00e5ff', r: 5, kind: 'dot', html: typeof html === 'string' ? html : undefined });
      }
    });
    const d = this.smooth.disp; this.m3.update({ pins, me: d ? { lat: d.lat, lng: d.lng, acc: this.smooth.acc } : undefined });
  }
  // ---- Flock camera (mapped) layer: static OSM export, lazy-loaded, only visible-bounds points drawn ----
  /** baseUrl = folder holding index.json + <lat>_<lng>.geojson tiles. */
  async showFlock(on: boolean, baseUrl: string) {
    this.flockOn = on;
    if (!on) { ++this.flockDraw; this.flockLayer.clearLayers(); this.flockLayer.remove(); this.map.attributionControl.removeAttribution(FLOCK_ATTRIBUTION); if (this.m3.active) this.mirror3d(); return; }
    await this.viewReady; if (!this.flockOn) return;
    this.flockLayer.addTo(this.map); this.map.attributionControl.addAttribution(FLOCK_ATTRIBUTION);
    this.flockBase = baseUrl;
    this.flockLoading ??= fetch(`${baseUrl}index.json`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(i => { this.flockIdx = i; });
    await this.flockLoading; await this.drawFlock();
  }
  // ---- Traffic enforcement cameras: static export, 5° tiles lazy-loaded, drawn only at zoom >= TC_MIN_ZOOM, capped per view ----
  async showTrafficCams(on: boolean, baseUrl: string) {
    this.tcOn = on;
    if (!on) { this.tcLayer.remove(); this.map.attributionControl.removeAttribution(TC_ATTRIBUTION); if (this.m3.active) this.mirror3d(); return; }
    await this.viewReady; if (!this.tcOn) return;
    this.tcLayer.addTo(this.map); this.map.attributionControl.addAttribution(TC_ATTRIBUTION);
    await this.loadTcIndex(baseUrl); await this.drawTc();
  }
  private async loadTcIndex(baseUrl: string) {
    this.tcBase = baseUrl;
    this.tcLoading ??= fetch(`${baseUrl}index.json`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(i => { this.tcIdx = i; });
    try { await this.tcLoading; } catch (e) { this.tcLoading = undefined; throw e; }
  }
  private tcTile(k: string) { let p = this.tcTiles.get(k); if (!p) { p = fetch(`${this.tcBase}${k}.json`).then(r => r.json()); p.catch(() => this.tcTiles.delete(k)); this.tcTiles.set(k, p); } return p.catch(() => undefined); }
  /** Which subtypes are drawn (undefined = all). */
  setTrafficCamTypes(types: Set<TcType>) { this.tcTypes = types; void this.drawTc(); }
  /** Cameras within rM of a point, for on-device alerts (independent of zoom). The position is used in memory only. */
  async trafficCamsNear(baseUrl: string, lat: number, lng: number, rM: number) {
    await this.loadTcIndex(baseUrl); if (!this.tcIdx) return [];
    const dLat = rM / 111_320, dLng = rM / (111_320 * Math.cos(lat * Math.PI / 180)), bb = { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
    const tiles = await Promise.all(tilesFor(this.tcIdx as any, bb).map(k => this.tcTile(k)));
    return tiles.flatMap(t => t ? tcInBounds(t, this.tcIdx!, bb, 500) : []);
  }
  get trafficCamInfo() { return this.tcIdx; }
  private async drawTc() {
    if (this.waitingForLocation) return;
    const gen = ++this.tcDraw;
    if (!this.tcIdx || !this.tcOn || this.map.getZoom() < TC_MIN_ZOOM) { this.tcLayer.clearLayers(); if (this.m3.active) this.mirror3d(); return; }
    const b = this.map.getBounds().pad(0.2), bb = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    const keys = tilesFor(this.tcIdx as any, bb);
    const tiles = await Promise.all(keys.map(k => this.tcTile(k)));
    if (gen !== this.tcDraw) return; this.tcLayer.clearLayers();
    for (const t of tiles) if (t) for (const p of tcInBounds(t, this.tcIdx, bb, undefined, this.tcTypes)) {
      const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'tcam-pin', html: tcIcon(p.type), iconSize: [16, 16], iconAnchor: [8, 8] }), keyboard: false, pane: 'tcPane', title: TC_META[p.type].label })
        ; const html = tcPopup(p); m.bindPopup(html); (m as any).tcType = p.type; (m as any).tcHtml = html; m.addTo(this.tcLayer);
    }
    if (this.m3.active) this.mirror3d();
  }
  get flockInfo() { return this.flockIdx ? { count: this.flockIdx.count, osmBase: this.flockIdx.osm_base } : undefined; }
  // ---- Historical stop heat: beat polygons, plus ~150 m grid cells only for stops that miss every beat. Not a live layer. ----
  async showStopHeat(on: boolean, baseUrl: string) {
    this.heatOn = on;
    if (!on) { ++this.heatDraw; this.heatLayer.clearLayers(); this.heatLayer.remove(); this.m3.setHeat({ type: 'FeatureCollection', features: [] }); this.map.attributionControl.removeAttribution(STOP_HEAT_ATTRIBUTION); return; }
    await this.viewReady; if (!this.heatOn) return;
    this.heatLayer.addTo(this.map); this.keepHeatUnderMarkers(); this.map.attributionControl.addAttribution(STOP_HEAT_ATTRIBUTION);
    await this.loadHeat(baseUrl); if (this.heatOn) await this.drawHeat();
  }
  /** Free preview is limited to overview shading; full filters require a verified Pro entitlement. */
  setStopHeatPreview(preview: boolean) { this.heatPreview = preview; if (this.heatOn) void this.drawHeat(); }
  /** year / time-of-day / weekday. Null means all. Counts are recomputed from the stored buckets. */
  setStopHeatFilter(f: HeatFilter) { this.heatFilter = this.heatPreview ? { ...OPEN_FILTER } : f; if (this.heatOn) void this.drawHeat(); }
  get stopHeatInfo() { return this.heatIdx; }
  private async loadHeat(baseUrl: string) {
    if (this.heatIdx && this.heatBase === baseUrl) return;
    this.heatBase = baseUrl; this.heatTiles.clear();
    this.heatLoading = fetch(`${baseUrl}index.json`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(async (i: StopHeatIndex) => {
      this.heatIdx = i;
      const files = await Promise.all((i.beatFiles ?? []).map(f => fetch(`${baseUrl}${f}`).then(r => r.ok ? r.json() : null)));
      this.heatBeats = files.filter(Boolean);
    });
    try { await this.heatLoading; } catch (e) { this.heatLoading = undefined; this.heatIdx = undefined; throw e; }
  }
  private heatTile(k: string) {
    let p = this.heatTiles.get(k);
    if (!p) { p = fetch(`${this.heatBase}tiles/${k}.json`).then(r => r.ok ? r.json() : undefined); p.catch(() => this.heatTiles.delete(k)); this.heatTiles.set(k, p); }
    return p;
  }
  private async drawHeat() {
    if (this.waitingForLocation) return;
    const gen = ++this.heatDraw; const idx = this.heatIdx;
    if (!idx || !this.heatOn) { this.heatLayer.clearLayers(); return; }
    const f = this.heatFilter;
    const paint = (n: number) => { const p = heatPaint(n); return { color: p.stroke, weight: 1, opacity: 0.9, fillColor: p.stroke, fillOpacity: p.fillOpacity * (this.heatPreview ? 0.4 : 1) }; };
    const features: GeoJSON.Feature[] = [];
    for (const fc of this.heatBeats) for (const feat of fc.features ?? []) {
      if (!countBuckets(feat.properties.b ?? [], feat.properties.o, f, idx.yearBase).n) continue;
      features.push({ type: 'Feature', geometry: feat.geometry as GeoJSON.Geometry, properties: feat.properties });
    }
    const group = L.geoJSON({ type: 'FeatureCollection', features } as GeoJSON.GeoJSON, {
      pane: 'heatPane', renderer: this.heatRenderer, interactive: false,
      style: (feat) => paint(countBuckets(feat?.properties?.b ?? [], feat?.properties?.o, this.heatFilter, idx.yearBase).n),
      onEachFeature: (_feat, layer) => {
        const path = layer as L.Path; path.options.renderer = this.heatRenderer; path.options.pane = 'heatPane';
        path.options.interactive = false;
      },
    } as L.GeoJSONOptions);
    let cells: L.Layer[] = [];
    const grid3d: GeoJSON.Feature[] = [];
    if (this.map.getZoom() >= HEAT_GRID_MIN_ZOOM) {
      const bnds = this.map.getBounds().pad(0.15);
      const bb = { south: bnds.getSouth(), west: bnds.getWest(), north: bnds.getNorth(), east: bnds.getEast() };
      const keys = heatTilesFor(idx, bb);
      const tiles = await Promise.all(keys.map(k => this.heatTile(k)));
      if (gen !== this.heatDraw) return;
      const picked: { n: number; layer: L.Layer; feature: GeoJSON.Feature }[] = [];
      for (const t of tiles) if (t) for (const cell of t) {
        const [lat, lng, , buckets, o] = cell;
        if (lat < bb.south || lat > bb.north || lng < bb.west || lng > bb.east) continue;
        const count = countBuckets(buckets, o, this.heatFilter, idx.yearBase);
        if (!count.n) continue;
        const dLat = idx.gridM / 111_320, dLng = idx.gridM / (111_320 * Math.cos((lat * Math.PI) / 180));
        const rect = L.rectangle([[lat - dLat / 2, lng - dLng / 2], [lat + dLat / 2, lng + dLng / 2]], { ...paint(count.n), renderer: this.heatRenderer, pane: 'heatPane', interactive: false });
        const pnt = heatPaint(count.n);
        const ring: [number, number][] = [[lng - dLng / 2, lat - dLat / 2], [lng + dLng / 2, lat - dLat / 2], [lng + dLng / 2, lat + dLat / 2], [lng - dLng / 2, lat + dLat / 2], [lng - dLng / 2, lat - dLat / 2]];
        picked.push({ n: count.n, layer: rect, feature: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { color: pnt.stroke, opacity: pnt.fillOpacity * (this.heatPreview ? 0.4 : 1) } } });
      }
      picked.sort((a, c) => c.n - a.n);
      const visible = picked.slice(0, HEAT_CELL_CAP);
      cells = visible.map(p => p.layer);
      grid3d.push(...visible.map(p => p.feature));
    }
    if (gen !== this.heatDraw) return;
    this.heatLayer.clearLayers(); group.addTo(this.heatLayer); for (const l of cells) l.addTo(this.heatLayer);
    this.keepHeatUnderMarkers();
    const beats3d: GeoJSON.Feature[] = features.map(f => {
      const props = f.properties ?? {};
      const count = countBuckets(props.b ?? [], props.o, this.heatFilter, idx.yearBase);
      const p = heatPaint(count.n);
      return { type: 'Feature', geometry: f.geometry, properties: { color: p.stroke, opacity: p.fillOpacity * (this.heatPreview ? 0.4 : 1) } };
    });
    this.m3.setHeat({ type: 'FeatureCollection', features: [...beats3d, ...grid3d] });
  }
  /** Other overlay canvases stay above the shading so their clicks still win. The location dot is in a higher pane. */
  private keepHeatUnderMarkers() {
    for (const g of [this.layer, this.liveLayer, this.crowdLayer, this.flockLayer, this.tcLayer]) {
      g.eachLayer(l => { const p = l as { bringToFront?: () => void }; if (p.bringToFront) { p.bringToFront(); return; } });
    }
  }
  private tile(k: string) {
    let p = this.flockTiles.get(k);
    if (!p) { p = fetch(`${this.flockBase}${k}.geojson`).then(r => r.json()); p.catch(() => this.flockTiles.delete(k)); this.flockTiles.set(k, p); }
    return p;
  }
  private scheduleFlock() {
    if (this.flockTimer !== undefined) return;
    this.flockTimer = window.setTimeout(() => { this.flockTimer = undefined; void this.drawFlock(); }, 400);
  }
  private async drawFlock() {
    if (this.waitingForLocation) return;
    const gen = ++this.flockDraw;
    if (!this.flockOn || !this.flockIdx || (this.m3.view()?.zoom ?? this.map.getZoom()) < FLOCK_MIN_ZOOM) { this.flockLayer.clearLayers(); if (this.m3.active) this.mirror3d(); return; }
    const bounds = this.m3.bounds();
    const b = (bounds ? L.latLngBounds([bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]) : this.map.getBounds()).pad(0.2); const bb = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    const tiles = await Promise.all(tilesFor(this.flockIdx, bb).map(k => this.tile(k).catch(() => undefined)));
    if (gen !== this.flockDraw) return; this.flockLayer.clearLayers();
    for (const t of tiles) if (t) for (const p of flockInBounds(t, bb))
      L.circleMarker([p.lat, p.lng], { renderer: this.flockRenderer, radius: 5, color: '#00e5ff', weight: 2, fillColor: '#0b3d4a', fillOpacity: 0.9, className: 'flock-mapped' })
        .bindPopup(`📷 <b>Flock camera (mapped)</b>${p.dir ? `<br>facing ${p.dir}°` : ''}<br><small>From OpenStreetMap, not a scan hit. <a href="https://www.openstreetmap.org/node/${p.id}" target="_blank" rel="noopener">OSM node</a></small>`)
        .addTo(this.flockLayer);
    if (this.m3.active) this.mirror3d();
  }
  private addLegend() {
    const Legend = L.Control.extend({ onAdd: () => { const d = L.DomUtil.create('div', 'map-legend'); L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); mountLegend(d); return d; } });
    new Legend({ position: 'bottomleft' }).addTo(this.map);
  }
  /** Fixed anchors for hits (in memory only). */
  readonly anchors = new LiveAnchors();
  /** User-relative live items (unknown devices, their rings): re-positioned with the smoothed user dot every frame. */
  private relItems: { layer: L.CircleMarker | L.Circle | L.Marker; dx: number; dy: number }[] = [];
  /** Current display position of "me" (smoothed), falling back to the last fix passed in. */
  private userDisp(fallback?: { lat: number; lng: number }) { const d = this.smooth.disp; return d ? { lat: d.lat, lng: d.lng } : fallback; }
  private moveRel() {
    const c = this.userDisp(); if (!c || !this.relItems.length) return;
    for (const it of this.relItems) { const p = applyOffset(c.lat, c.lng, { dx: it.dx, dy: it.dy }); it.layer.setLatLng([p.lat, p.lng]); }
  }
  /** Drops fixed anchors (call on Stop). */
  clearLive() { this.anchors.clear(); this.loc.clearSeries(); this.relItems = []; this.liveLayer.clearLayers(); }
  /** Live device dots. Display-only; never persisted.
   * Police hits and grouped vehicles are pinned where they were first detected; unknown devices are drawn around the
   * user and follow the user dot frame by frame. Wi-Fi hits get a thick blue ring and a 📶 badge. */
  renderLive(devs: LiveDevice[], center: { lat: number; lng: number } | undefined, now = Date.now(), vehicles: Vehicle[] = []) {
    this.renderLive2D(devs, center, now, vehicles); if (this.m3.active) this.mirror3d();
  }
  private renderLive2D(devs: LiveDevice[], center: { lat: number; lng: number } | undefined, now: number, vehicles: Vehicle[]) {
    this.liveLayer.clearLayers(); this.relItems = []; this.anchors.prune(now); this.loc.prune(now);
    const me = this.userDisp(center); if (!me) return;
    const grouped = new Set(vehicles.flatMap(v => v.members.map(m => m.key)));
    devs = devs.filter(d => !grouped.has(d.key));
    // Past ~200 dots the follow-me pan redraws janked a 4x-throttled phone profile; police matches always draw first.
    if (devs.length > MAX_LIVE_DOTS) devs = [...devs].sort((a, b) => (a.kind === 'match' ? 0 : 1) - (b.kind === 'match' ? 0 : 1) || b.rssi - a.rssi).slice(0, MAX_LIVE_DOTS);
    // Hits: best estimate (closest approach along our track) if there is one, else where first detected. Unknowns: around us.
    const place = (key: string, fixed: boolean, o: { dx: number; dy: number }, keys = [key]) => {
      const est = fixed ? this.loc.estimateAny(keys) : undefined;
      if (est) { this.anchors.set(key, est, now); return { base: est as { lat: number; lng: number }, p: { lat: est.lat, lng: est.lng }, rel: false, est }; }
      const anc = this.anchors.anchor(key, fixed, me, now); const base = anc ?? me; return { base, p: applyOffset(base.lat, base.lng, o), rel: !anc, est: undefined as Estimate | undefined };
    };
    const where = (est: Estimate | undefined, rel: boolean) => rel ? '' : est ? `<br><small>${est.quality === 'moving' ? `seems to be moving with you · last heard near here (±${est.radius} m)` : `${est.quality === 'approx' ? 'approx. ' : 'closest approach · '}±${est.radius} m · side of road unknown`}</small>` : '<br><small>pinned where first detected</small>';
    const uncert = (est: Estimate | undefined, color: string, op: number) => { if (est) add(L.circle([est.lat, est.lng], { renderer: this.liveRenderer, radius: est.radius, color, weight: 1, dashArray: est.quality === 'closest-approach' ? undefined : '4 4', opacity: 0.6 * op, fillColor: color, fillOpacity: 0.12 * op, interactive: false }), false); };
    const add = <T extends L.CircleMarker | L.Circle | L.Marker>(layer: T, rel: boolean, dx = 0, dy = 0): T => { layer.addTo(this.liveLayer); if (rel) this.relItems.push({ layer, dx, dy }); return layer; };
    for (const d of devs) {
      const o = offsetFor(d.key); const { base, p, rel, est } = place(d.key, d.kind === 'match', o); const op = opacityFor(d.lastSeen, now); const wifi = d.radio === 'wifi';
      if (est) uncert(est, wifi ? WIFI_COLOR : d.color, op); else add(L.circle([base.lat, base.lng], { renderer: this.liveRenderer, radius: bandRadius(d.band), color: wifi ? WIFI_COLOR : d.color, weight: wifi ? 2 : 1, dashArray: wifi ? '6 4' : undefined, opacity: (wifi ? 0.8 : 0.4) * op, fillOpacity: 0.07 * op, interactive: false }), rel);
      const ago = Math.round((now - d.lastSeen) / 1000);
      const popup = `${wifi ? '📶 <b>Wi-Fi access point</b> · ' : ''}${d.label}<br>${wifi ? `<small>${WIFI_EVIDENCE_LINE}</small><br>` : ''}${d.confidence !== undefined ? `conf ${(d.confidence * 100).toFixed(0)}%<br>` : ''}${d.band} (~${bandRadius(d.band)} m est.) · RSSI ${d.rssi}<br>last seen ${ago}s ago${where(est, rel)}`;
      add(L.circleMarker([p.lat, p.lng], { renderer: this.liveRenderer, radius: wifi ? 8 : 6, color: wifi ? WIFI_COLOR : '#111', weight: wifi ? 3 : 1, fillColor: d.color, fillOpacity: op, opacity: op }).bindPopup(popup), rel, o.dx, o.dy);
      if (wifi) add(L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'wifi-pin', html: '📶', iconSize: [18, 18], iconAnchor: [-4, 22] }), opacity: op, interactive: false, keyboard: false }), rel, o.dx, o.dy);
    }
    for (const v of vehicles) {
      const { p, est } = place(v.id, true, offsetFor(v.id), v.members.map(m => m.key)); const op = opacityFor(v.lastSeen, now);
      uncert(est, '#ff1744', op);
      const list = v.members.map(m => `${m.radio === 'wifi' ? '📶' : 'ᛒ'} ${m.ruleId} (${Math.round(m.confidence * 100)}%)`).join('<br>');
      add(L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'veh-pin', html: `🚓 ${v.members.length}`, iconSize: [44, 22], iconAnchor: [22, 11] }), opacity: op, zIndexOffset: 1000 })
        .bindPopup(`🚓 <b>Possible patrol vehicle</b> · ${Math.round(v.confidence * 100)}%<br>${v.members.length} signals (${v.radios.join(' + ')})${v.rssiCorrelated ? ', signal strength moves together' : ''}<br><small>${list}</small><br><small>best single signal ${Math.round(v.baseConfidence * 100)}%, +${Math.round(v.boost * 100)} for corroboration (capped)</small><br><small>${VEHICLE_EVIDENCE_LINE}</small>${where(est, false)}`), false);
    }
  }
}
