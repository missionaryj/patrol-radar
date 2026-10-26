import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Report } from '../reports/types';
import type { Incident } from '../radio/types';
import { type LiveDevice, BAND_RADIUS_M, offsetFor, applyOffset, opacityFor } from './liveDevices';
import { TTL_MS } from '../reports/localStore';

export interface MapViewOptions { dark?: boolean; legend?: boolean; layersControl?: boolean; zoomControl?: boolean; }
export class MapView {
  private map: L.Map;
  private layer = L.layerGroup();
  readonly incidentLayer = L.layerGroup();
  readonly liveLayer = L.layerGroup();
  constructor(el: HTMLElement, center: [number, number] = [41.88, -87.63], opts: MapViewOptions = {}) {
    this.map = L.map(el, { zoomControl: opts.zoomControl ?? true }).setView(center, 15);
    // dark: OSM tiles darkened via CSS filter (.tiles-dark), no API key needed
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', className: opts.dark ? 'tiles-dark' : '' }).addTo(this.map);
    this.layer.addTo(this.map); this.incidentLayer.addTo(this.map); this.liveLayer.addTo(this.map);
    if (opts.legend ?? true) this.addLegend();
    if (opts.layersControl ?? true) L.control.layers(undefined, { 'BLE detections': this.layer, 'Radio incidents (demo)': this.incidentLayer, 'Live devices (estimate)': this.liveLayer }).addTo(this.map);
  }
  invalidate() { this.map.invalidateSize(); }
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
      L.rectangle([[i.cell.lat - d, i.cell.lng - d * 1.3], [i.cell.lat + d, i.cell.lng + d * 1.3]], { color: '#39f', dashArray: '4', fillOpacity: 0.15 + 0.3 * i.confidence })
        .bindPopup(`Incident: ${i.callType}<br>conf ${(i.confidence * 100).toFixed(0)}% · ${i.reports} msgs<br>${Math.round((now - i.firstSeen) / 60000)} min ago<br><i>demo, undelayed</i>`)
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
  }
  recenter(): boolean { if (!this.me) return false; this.map.setView(this.me.getLatLng(), Math.max(this.map.getZoom(), 15)); return true; }
  private addLegend() {
    const Legend = L.Control.extend({ onAdd: () => { const d = L.DomUtil.create('div', 'legend');
      d.innerHTML = '<b>Live devices</b><br><i style="background:#e53935"></i>Axon / body cam / CEW<br><i style="background:#fb8c00"></i>Radio (Motorola)<br><i style="background:#fdd835"></i>Other match<br><i style="background:#8a9bb0"></i>Unmatched / picked<br><small>Dot position is illustrative; ring = rough RSSI range estimate</small>';
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
