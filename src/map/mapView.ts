import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Report } from '../reports/types';
import type { Incident } from '../radio/types';
import type { CrowdCell } from '../crowd/protocol';
import { type LiveDevice, BAND_RADIUS_M, offsetFor, applyOffset, opacityFor } from './liveDevices';
import { TTL_MS } from '../reports/localStore';
import { FollowController } from './follow';
import { type FlockCollection, type FlockIndex, FLOCK_ATTRIBUTION, FLOCK_MIN_ZOOM, flockInBounds, tilesFor } from './flockLayer';

export interface MapViewOptions { dark?: boolean; legend?: boolean; layersControl?: boolean; zoomControl?: boolean; }
export class MapView {
  private map: L.Map;
  private layer = L.layerGroup();
  readonly incidentLayer = L.layerGroup();
  readonly liveLayer = L.layerGroup();
  readonly crowdLayer = L.layerGroup();
  readonly flockLayer = L.layerGroup();
  readonly follow: FollowController;
  /** Called when follow-me pauses (manual pan) or resumes. */
  onFollowChange?: (following: boolean) => void;
  private flockIdx?: FlockIndex; private flockBase = ''; private flockTiles = new Map<string, Promise<FlockCollection>>(); private flockOn = false; private flockLoading?: Promise<void>; private flockDraw = 0;
  private flockRenderer = L.canvas({ padding: 0.3 });
  constructor(el: HTMLElement, center: [number, number] = [41.88, -87.63], opts: MapViewOptions = {}) {
    this.map = L.map(el, { zoomControl: opts.zoomControl ?? true }).setView(center, 15);
    // dark: OSM tiles darkened via CSS filter (.tiles-dark), no API key needed
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', className: opts.dark ? 'tiles-dark' : '' }).addTo(this.map);
    this.layer.addTo(this.map); this.incidentLayer.addTo(this.map); this.liveLayer.addTo(this.map); this.crowdLayer.addTo(this.map);
    if (opts.legend ?? true) this.addLegend();
    this.follow = new FollowController(true, f => this.onFollowChange?.(f));
    this.map.on('dragstart', () => this.follow.userPanned());
    this.map.on('moveend', () => { if (this.flockOn) void this.drawFlock(); });
    if (opts.layersControl ?? true) L.control.layers(undefined, { 'Flock camera (mapped)': this.flockLayer, 'BLE detections': this.layer, 'Radio incidents (delayed)': this.incidentLayer, 'Live devices (estimate)': this.liveLayer, 'Crowd (shared, delayed)': this.crowdLayer }).addTo(this.map);
  }
  invalidate() { this.map.invalidateSize(); }
  showIncidents(on: boolean) { if (on) this.incidentLayer.addTo(this.map); else this.incidentLayer.remove(); }
  fitIncidents() { const b = this.incidentLayer.getLayers().map(l => (l as L.Rectangle).getBounds()); if (b.length) this.map.fitBounds(b.reduce((a, x) => a.extend(x), L.latLngBounds(b[0].getSouthWest(), b[0].getNorthEast())), { padding: [30, 30], maxZoom: 15 }); }
  showCrowd(on: boolean) { if (on) this.crowdLayer.addTo(this.map); else this.crowdLayer.remove(); }
  /** Crowd cells: purple ~200 m squares; solid when confirmed (2+ reporters or high conf), faint dotted when single-reporter. */
  renderCrowd(cells: CrowdCell[], now = Date.now()) {
    this.crowdLayer.clearLayers();
    for (const c of cells) {
      const d = 0.0009, f = c.confirmed;
      L.rectangle([[c.lat - d, c.lng - d * 1.3], [c.lat + d, c.lng + d * 1.3]], { color: '#b03cff', weight: f ? 2.5 : 1, dashArray: f ? undefined : '2 4', opacity: f ? 0.95 : 0.45, fillColor: '#b03cff', fillOpacity: f ? 0.32 : 0.08, className: 'crowd-pin' })
        .bindTooltip(f ? '👥' : '·', { permanent: true, direction: 'center', className: 'incident-icon' })
        .bindPopup(`👥 <b>${c.kind}</b> · ${f ? 'crowd confirmed' : 'single report'}<br>${c.reporters} reporter${c.reporters > 1 ? 's' : ''} · conf ${c.conf}<br>~${Math.round((now - c.last) / 60000)} min ago (≥12 min delay)<br><small>~200 m area, shared by other users</small>`)
        .addTo(this.crowdLayer);
    }
  }
  setCenter(lat: number, lng: number) { this.map.setView([lat, lng]); }
  /** Coarse cells, opacity decays linearly to 0 at TTL. */
  render(reports: Report[], now = Date.now()) {
    this.layer.clearLayers();
    for (const r of reports) {
      const fade = Math.max(0, 1 - (now - r.timestamp) / TTL_MS);
      L.circle([r.lat, r.lng], { radius: 120, color: '#e33', fillOpacity: 0.35 * fade, opacity: fade })
        .bindPopup(`${r.label}<br>conf ${(r.confidence * 100).toFixed(0)}%<br>${Math.round((now - r.timestamp) / 60000)} min ago`)
        .addTo(this.layer);
    }
  }
  /** Incidents: blue dashed squares = coarse area of a call, never a unit position. */
  renderIncidents(incs: Incident[], now = Date.now()) {
    this.incidentLayer.clearLayers();
    for (const i of incs) {
      const d = 0.0009;
      L.rectangle([[i.cell.lat - d, i.cell.lng - d * 1.3], [i.cell.lat + d, i.cell.lng + d * 1.3]], { color: '#39f', weight: 2, dashArray: '5 4', fillColor: '#39f', fillOpacity: 0.12 + 0.3 * i.confidence, className: 'incident-pin' })
        .bindTooltip('📻', { permanent: true, direction: 'center', className: 'incident-icon' })
        .bindPopup(`📻 <b>${i.callType}</b><br>conf ${(i.confidence * 100).toFixed(0)}% · ${i.reports} msg${i.reports > 1 ? 's' : ''}<br>${Math.round((now - i.firstSeen) / 60000)} min ago (≥12 min delay)<br><small>~200 m area, not a unit position</small>`)
        .addTo(this.incidentLayer);
    }
  }
  private me?: L.CircleMarker; private meAcc?: L.Circle; private centered = false;
  /** Display-only "my location". Precise coords live only in these Leaflet layers, never stored or reported. */
  setUserLocation(lat: number, lng: number, accuracy: number) {
    if (!this.me) {
      this.meAcc = L.circle([lat, lng], { radius: accuracy, color: '#2a7fff', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(this.map);
      this.me = L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2a7fff', fillOpacity: 1, interactive: false }).addTo(this.map);
    } else { this.me.setLatLng([lat, lng]); this.meAcc!.setLatLng([lat, lng]).setRadius(accuracy); }
    if (!this.centered) { this.centered = true; this.map.setView([lat, lng], 16); }
    else if (this.follow.onFix()) this.map.panTo([lat, lng], { animate: true, duration: 0.5, noMoveStart: true });
  }
  /** Recenter and resume follow-me. */
  recenter(): boolean { this.follow.resume(); if (!this.me) return false; this.map.setView(this.me.getLatLng(), Math.max(this.map.getZoom(), 15)); return true; }
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
      d.innerHTML = '<b>Live devices</b><br><i style="background:#e53935"></i>Axon / body cam / CEW<br><i style="background:#fb8c00"></i>Radio (Motorola)<br><i style="background:#fdd835"></i>Other match<br><i style="background:#8a9bb0"></i>Unmatched / picked<br><i style="background:#0b3d4a;border:2px solid #00e5ff"></i>Flock camera (mapped, OSM)<br><small>Dot position is illustrative; ring = rough RSSI range estimate</small>';
      return d; } });
    new Legend({ position: 'bottomleft' }).addTo(this.map);
  }
  /** Live device dots around the user's current position. Display-only; never persisted. */
  renderLive(devs: LiveDevice[], center: { lat: number; lng: number } | undefined, now = Date.now()) {
    this.liveLayer.clearLayers(); if (!center) return;
    for (const d of devs) {
      const p = applyOffset(center.lat, center.lng, offsetFor(d.key)); const op = opacityFor(d.lastSeen, now);
      L.circle([center.lat, center.lng], { radius: BAND_RADIUS_M[d.band], color: d.color, weight: 1, opacity: 0.4 * op, fillOpacity: 0.07 * op, interactive: false }).addTo(this.liveLayer);
      const ago = Math.round((now - d.lastSeen) / 1000);
      L.circleMarker([p.lat, p.lng], { radius: 6, color: '#111', weight: 1, fillColor: d.color, fillOpacity: op, opacity: op })
        .bindPopup(`${d.label}<br>${d.confidence !== undefined ? `conf ${(d.confidence * 100).toFixed(0)}%<br>` : ''}${d.band} (~${BAND_RADIUS_M[d.band]} m est.) · RSSI ${d.rssi}<br>last seen ${ago}s ago`)
        .addTo(this.liveLayer);
    }
  }
}
