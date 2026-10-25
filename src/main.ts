import './style.css';
import { createScanner, match, type Scanner } from './ble';
import { MapView, coarsen } from './map';
import { LocalReportStore } from './reports';
import { startMockRadioFeed } from './radio/mockFeed';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const store = new LocalReportStore();
const map = new MapView($('map'));
let pos = { lat: 41.88, lng: -87.63 }; // demo default (Chicago) until geolocation resolves
let scanner: Scanner | undefined;
const lastSeen = new Map<string, number>();

navigator.geolocation?.watchPosition(p => {
  pos = coarsen(p.coords.latitude, p.coords.longitude); map.setCenter(pos.lat, pos.lng);
}, () => {}, { enableHighAccuracy: false });

function jitterDemo() { // mock mode: scatter demo points around the coarse cell
  return coarsen(pos.lat + (Math.random() - 0.5) * 0.01, pos.lng + (Math.random() - 0.5) * 0.01);
}

$('start').onclick = async () => {
  const kind = $<HTMLSelectElement>('backend').value as 'mock' | 'web';
  scanner = createScanner(kind);
  if (!(await scanner.isSupported())) { $('status').textContent = 'Web Bluetooth not available here; use Mock.'; return; }
  try {
    await scanner.start(adv => {
      const m = match(adv); if (!m) return;
      if (Date.now() - (lastSeen.get(m.sessionId) ?? 0) < 30_000) return; // de-dupe per 30s
      lastSeen.set(m.sessionId, Date.now());
      const loc = kind === 'mock' ? jitterDemo() : pos;
      store.add({ id: crypto.randomUUID(), category: m.signature.category, label: m.signature.label, confidence: m.confidence, ...loc, timestamp: m.timestamp });
      const li = document.createElement('li');
      li.textContent = `${new Date(m.timestamp).toLocaleTimeString()} · ${m.signature.label} · ${(m.confidence * 100).toFixed(0)}% · RSSI ${m.rssi ?? '?'} · session ${m.sessionId} (${m.signature.status})`;
      $('log').prepend(li);
      map.render(store.list());
    });
    $('status').textContent = `Scanning (${scanner.name})…`; $<HTMLButtonElement>('start').disabled = true; $<HTMLButtonElement>('stop').disabled = false;
  } catch (e) { $('status').textContent = String(e); }
};
$('stop').onclick = () => { scanner?.stop(); $('status').textContent = 'Stopped'; $<HTMLButtonElement>('start').disabled = false; $<HTMLButtonElement>('stop').disabled = true; };
setInterval(() => map.render(store.list()), 10_000);
map.render(store.list());

let stopRadio: (() => void) | undefined;
$<HTMLInputElement>('radio').onchange = e => {
  if ((e.target as HTMLInputElement).checked) stopRadio = startMockRadioFeed(incs => map.renderIncidents(incs));
  else { stopRadio?.(); map.renderIncidents([]); }
};
