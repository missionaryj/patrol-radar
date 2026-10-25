import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Report } from '../reports/types';
import type { Incident } from '../radio/types';
import { TTL_MS } from '../reports/localStore';

export class MapView {
  private map: L.Map;
  private layer = L.layerGroup();
  readonly incidentLayer = L.layerGroup();
  constructor(el: HTMLElement, center: [number, number] = [41.88, -87.63]) {
    this.map = L.map(el).setView(center, 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(this.map);
    this.layer.addTo(this.map); this.incidentLayer.addTo(this.map);
    L.control.layers(undefined, { 'BLE detections': this.layer, 'Radio incidents (demo)': this.incidentLayer }).addTo(this.map);
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
}
