import { Localizer, type Estimate } from '../fusion/localize';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Report } from '../reports/types';
import type { CrowdCell } from '../crowd/protocol';
import { type LiveDevice, bandRadius, WIFI_COLOR, offsetFor, applyOffset, opacityFor, LiveAnchors } from './liveDevices';
import type { Vehicle } from '../fusion/vehicles';
import { TTL_MS } from '../reports/localStore';
import { FollowController } from './follow';
import { SmoothLocation } from './smoothFollow';
import { RASTER_2D, PITCH_3D } from './palette';
import { Map3D, type Pin3D } from './map3d';
import { type FlockCollection, type FlockIndex, FLOCK_ATTRIBUTION, FLOCK_MIN_ZOOM, flockInBounds, tilesFor } from './flockLayer';

/** Cap on live dots drawn (police matches first, then strongest RSSI). See scripts/stress/map.html. */
export const MAX_LIVE_DOTS = 150;
export interface MapViewOptions { dark?: boolean; legend?: boolean; layersControl?: boolean; zoomControl?: boolean; }
export class MapView {
  private map: L.Map;
  private m3: Map3D; private lastMirror = 0;
  private layer = L.layerGroup();
  readonly liveLayer = L.layerGroup();
  readonly crowdLayer = L.layerGroup();
  readonly flockLayer = L.layerGroup();
  readonly follow: FollowController;
  /** Called when follow-me pauses (manual pan) or resumes. */
  onFollowChange?: (following: boolean) => void;
  private flockIdx?: FlockIndex; private flockBase = ''; private flockTiles = new Map<string, Promise<FlockCollection>>(); private flockOn = false; private flockLoading?: Promise<void>; private flockDraw = 0;
  private flockRenderer = L.canvas({ padding: 0.3 });
  /** Live dots/rings on one canvas: hundreds of SVG paths rebuilt per refresh janked the map (see scripts/stress). */
  private liveRenderer = L.canvas({ padding: 0.3 });
  constructor(el: HTMLElement, center: [number, number] = [41.88, -87.63], opts: MapViewOptions = {}) {
    this.map = L.map(el, { zoomControl: opts.zoomControl ?? true }).setView(center, 15);
    // Cool-slate basemap (OSM tiles + CSS filter, no API key); .tiles-slate adds a slight blue-grey tint.
    L.tileLayer(opts.dark ? RASTER_2D.dark : RASTER_2D.light, { maxZoom: 19, attribution: RASTER_2D.attribution, className: opts.dark ? 'tiles-slate-dark' : 'tiles-slate' }).addTo(this.map);
    const el3 = L.DomUtil.create('div', 'map3d', el); el3.hidden = true; L.DomEvent.disableClickPropagation(el3); L.DomEvent.disableScrollPropagation(el3);
    this.m3 = new Map3D(el3, opts.dark ? 'dark' : 'light', () => this.follow.userPanned());
    this.layer.addTo(this.map); this.liveLayer.addTo(this.map); this.crowdLayer.addTo(this.map);
    if (opts.legend ?? true) this.addLegend();
    this.follow = new FollowController(true, f => this.onFollowChange?.(f));
    this.map.on('dragstart', () => this.follow.userPanned());
    // Follow-me moves the map every frame, so redraw Flock dots at most every ~400 ms instead of on every moveend.
    this.map.on('moveend', () => { if (this.flockOn && this.flockTimer === undefined) this.flockTimer = window.setTimeout(() => { this.flockTimer = undefined; void this.drawFlock(); }, 400); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick(); });
    if (opts.layersControl ?? true) L.control.layers(undefined, { 'Flock camera (mapped)': this.flockLayer, 'BLE detections': this.layer, 'Live devices (estimate)': this.liveLayer, 'Crowd (shared, delayed)': this.crowdLayer }).addTo(this.map);
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
  private me?: L.CircleMarker; private meAcc?: L.Circle; private centered = false;
  private smooth = new SmoothLocation(); private raf?: number; private lastFrame = 0; private flockTimer?: number;
  /** Display-only "my location". Precise coords live only in these Leaflet layers and in memory, never stored or reported. */
  setUserLocation(lat: number, lng: number, accuracy: number, speed?: number | null, heading?: number | null, t = Date.now()) {
    const first = this.smooth.push({ lat, lng, acc: accuracy, t, speed, heading });
    this.loc.fix({ t, lat, lng, acc: accuracy, speed }); // in-memory track for closest-approach pins (never stored)
    if (!this.me) {
      this.meAcc = L.circle([lat, lng], { radius: accuracy, color: '#2a7fff', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(this.map);
      this.me = L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2a7fff', fillOpacity: 1, interactive: false }).addTo(this.map);
    }
    if (first || !this.centered) { this.centered = true; this.map.setView([lat, lng], Math.max(this.map.getZoom(), 16), { animate: false }); }
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
    if (this.follow.onFix()) { this.map.setView([d.lat, d.lng], this.map.getZoom(), { animate: false, noMoveStart: true } as L.ZoomPanOptions); this.m3.follow(d.lat, d.lng); }
    if (this.m3.active && ts - this.lastMirror > 200) this.mirror3d();
    if (more && !document.hidden) this.raf = requestAnimationFrame(this.frame);
  };
  /** Recenter and resume follow-me. */
  recenter(): boolean { this.follow.resume(); if (!this.me) return false; const c = this.smooth.disp ?? this.me.getLatLng(); this.map.setView(c, Math.max(this.map.getZoom(), 15)); this.m3.follow(c.lat, c.lng); this.kick(); return true; }
  // ---- 3D view (extruded buildings). Leaflet keeps all state; the 3D map mirrors pins + own dot. ----
  get is3D() { return this.m3.active; }
  async set3D(on: boolean) {
    if (!on) { const v = this.m3.view(); this.m3.close(); if (v && !this.follow.following) this.map.setView([v.lat, v.lng], Math.round(v.zoom)); return; }
    const c = this.smooth.disp ?? this.map.getCenter(); await this.m3.open({ lat: c.lat, lng: c.lng }, this.map.getZoom()); this.mirror3d(); this.kick();
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
    const d = this.smooth.disp; this.m3.update({ pins, me: d ? { lat: d.lat, lng: d.lng, acc: this.smooth.acc } : undefined });
  }
  // ---- Flock camera (mapped) layer: static OSM export, lazy-loaded, only visible-bounds points drawn ----
  /** baseUrl = folder holding index.json + <lat>_<lng>.geojson tiles. */
  async showFlock(on: boolean, baseUrl: string) {
    this.flockOn = on;
    if (!on) { this.flockLayer.remove(); this.map.attributionControl.removeAttribution(FLOCK_ATTRIBUTION); return; }
    this.flockLayer.addTo(this.map); this.map.attributionControl.addAttribution(FLOCK_ATTRIBUTION);
    this.flockBase = baseUrl;
    this.flockLoading ??= fetch(`${baseUrl}index.json`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(i => { this.flockIdx = i; });
    await this.flockLoading; await this.drawFlock();
  }
  get flockInfo() { return this.flockIdx ? { count: this.flockIdx.count, osmBase: this.flockIdx.osm_base } : undefined; }
  private tile(k: string) {
    let p = this.flockTiles.get(k);
    if (!p) { p = fetch(`${this.flockBase}${k}.geojson`).then(r => r.json()); p.catch(() => this.flockTiles.delete(k)); this.flockTiles.set(k, p); }
    return p;
  }
  private async drawFlock() {
    const gen = ++this.flockDraw;
    if (!this.flockIdx || this.map.getZoom() < FLOCK_MIN_ZOOM) { this.flockLayer.clearLayers(); return; }
    const b = this.map.getBounds().pad(0.2); const bb = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    const tiles = await Promise.all(tilesFor(this.flockIdx, bb).map(k => this.tile(k).catch(() => undefined)));
    if (gen !== this.flockDraw) return; this.flockLayer.clearLayers();
    for (const t of tiles) if (t) for (const p of flockInBounds(t, bb))
      L.circleMarker([p.lat, p.lng], { renderer: this.flockRenderer, radius: 5, color: '#00e5ff', weight: 2, fillColor: '#0b3d4a', fillOpacity: 0.9, className: 'flock-mapped' })
        .bindPopup(`📷 <b>Flock camera (mapped)</b>${p.dir ? `<br>facing ${p.dir}°` : ''}<br><small>From OpenStreetMap, not a scan hit. <a href="https://www.openstreetmap.org/node/${p.id}" target="_blank" rel="noopener">OSM node</a></small>`)
        .addTo(this.flockLayer);
  }
  private addLegend() {
    const Legend = L.Control.extend({ onAdd: () => { const d = L.DomUtil.create('div', 'legend');
      d.innerHTML = '<b>Live devices</b><br><i style="background:#e53935"></i>Axon / body cam / CEW<br><i style="background:#fb8c00"></i>Radio (Motorola)<br><i style="background:#fdd835"></i>Other match<br><span class="wifi-pin" style="position:static;display:inline-block;margin-right:4px">📶</span>Wi-Fi hit (blue ring)<br><span class="veh-pin" style="position:static;display:inline-block;margin-right:4px">🚓</span>Vehicle (several signals grouped)<br><i style="background:#8a9bb0"></i>Unmatched / picked<br><i style="background:#0b3d4a;border:2px solid #00e5ff"></i>Flock camera (mapped, OSM)<br><small>Dot position is illustrative; ring = rough RSSI range estimate</small>';
      return d; } });
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
      const popup = `${wifi ? '📶 <b>Wi-Fi</b> · ' : ''}${d.label}<br>${d.confidence !== undefined ? `conf ${(d.confidence * 100).toFixed(0)}%<br>` : ''}${d.band} (~${bandRadius(d.band)} m est.) · RSSI ${d.rssi}<br>last seen ${ago}s ago${where(est, rel)}`;
      add(L.circleMarker([p.lat, p.lng], { renderer: this.liveRenderer, radius: wifi ? 8 : 6, color: wifi ? WIFI_COLOR : '#111', weight: wifi ? 3 : 1, fillColor: d.color, fillOpacity: op, opacity: op }).bindPopup(popup), rel, o.dx, o.dy);
      if (wifi) add(L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'wifi-pin', html: '📶', iconSize: [18, 18], iconAnchor: [-4, 22] }), opacity: op, interactive: false, keyboard: false }), rel, o.dx, o.dy);
    }
    for (const v of vehicles) {
      const { p, est } = place(v.id, true, offsetFor(v.id), v.members.map(m => m.key)); const op = opacityFor(v.lastSeen, now);
      uncert(est, '#ff1744', op);
      const list = v.members.map(m => `${m.radio === 'wifi' ? '📶' : 'ᛒ'} ${m.ruleId} (${Math.round(m.confidence * 100)}%)`).join('<br>');
      add(L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'veh-pin', html: `🚓 ${v.members.length}`, iconSize: [44, 22], iconAnchor: [22, 11] }), opacity: op, zIndexOffset: 1000 })
        .bindPopup(`🚓 <b>Possible patrol vehicle</b> · ${Math.round(v.confidence * 100)}%<br>${v.members.length} signals (${v.radios.join(' + ')})${v.rssiCorrelated ? ', signal strength moves together' : ''}<br><small>${list}</small><br><small>best single signal ${Math.round(v.baseConfidence * 100)}%, +${Math.round(v.boost * 100)} for corroboration (capped)</small>${where(est, false)}`), false);
    }
  }
}
