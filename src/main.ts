import './style.css';
import { createScanner, match, pickDefaultBackend, isBluefy, classify, type Scanner, type BackendKind } from './ble';
import { MapView, coarsen } from './map';
import { LocalReportStore } from './reports';
import { startMockRadioFeed } from './radio/mockFeed';
import { ScanStats } from './ble/stats';
import { probeReport, findScanApis } from './ble/probe';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const store = new LocalReportStore();
const map = new MapView($('map'));
let pos = { lat: 41.88, lng: -87.63 };
let scanner: Scanner | undefined;
const lastSeen = new Map<string, number>();
const stats = new ScanStats();

function status(msg: string, cls: '' | 'ok' | 'err' = '') { const s = $('status'); s.textContent = msg; s.className = cls; }
function renderStats() {
  $('d-raw').textContent = String(stats.raw); $('d-unmatched').textContent = String(stats.unmatched); $('d-matched').textContent = String(stats.matched);
  $('d-last').textContent = stats.lastAt ? `${Math.round((Date.now() - stats.lastAt) / 1000)}s ago` : 'never';
}
setInterval(renderStats, 1000);

const bt = (navigator as any).bluetooth;
$('d-env').textContent = `navigator.bluetooth: ${bt ? 'yes' : 'no'} · requestLEScan: ${typeof bt?.requestLEScan === 'function'} · scan/advert APIs: ${findScanApis().map(f => f.path).join(', ') || 'none'} · device.watchAdvertisements: ${typeof (window as any).BluetoothDevice?.prototype?.watchAdvertisements === 'function'} · secure: ${window.isSecureContext} · bluefy: ${isBluefy()}`;
$('d-probe').textContent = probeReport();
const sel = $<HTMLSelectElement>('backend');
sel.value = pickDefaultBackend();
if (sel.value === 'bluefy') status('Bluefy detected; Bluefy backend selected. Tap Start scan.', 'ok');

navigator.geolocation?.watchPosition(p => { pos = coarsen(p.coords.latitude, p.coords.longitude); map.setCenter(pos.lat, pos.lng); }, () => {}, { enableHighAccuracy: false });
const jitterDemo = () => coarsen(pos.lat + (Math.random() - 0.5) * 0.01, pos.lng + (Math.random() - 0.5) * 0.01);

$('start').onclick = async () => {
  const kind = sel.value as BackendKind;
  scanner = createScanner(kind); stats.reset(); $('d-backend').textContent = kind; $('d-mode').textContent = '-';
  if (!(await scanner.isSupported())) {
    status(kind === 'mock' ? 'Mock unavailable?' : 'No Web Bluetooth in this browser. On iPhone use the Bluefy browser; on Android use Chrome. Or pick Mock.', 'err'); return;
  }
  status('Starting…');
  try {
    await scanner.start(adv => {
      const m = match(adv); stats.record(!!m);
      if (!m) return;
      if (Date.now() - (lastSeen.get(m.sessionId) ?? 0) < 30_000) return;
      lastSeen.set(m.sessionId, Date.now());
      const loc = kind === 'mock' ? jitterDemo() : pos;
      store.add({ id: crypto.randomUUID(), category: m.signature.category, label: m.signature.label, confidence: m.confidence, ...loc, timestamp: m.timestamp });
      const li = document.createElement('li');
      li.textContent = `${new Date(m.timestamp).toLocaleTimeString()} · ${m.signature.label} · ${(m.confidence * 100).toFixed(0)}% · RSSI ${m.rssi ?? '?'} · session ${m.sessionId} (${m.signature.status})`;
      $('log').prepend(li); map.render(store.list());
    });
    $('d-mode').textContent = (scanner as any).mode || scanner.name;
    status(`Scanning (${scanner.name}). Watch "adverts seen" in Debug: if it stays 0 for 30 s with Bluetooth devices around, scanning is not working.`, 'ok');
    $<HTMLButtonElement>('start').disabled = true; $<HTMLButtonElement>('stop').disabled = false;
    setTimeout(() => { if (scanner && stats.raw === 0 && kind !== 'mock') status('No advertisements received in 20 s. Check Bluetooth is on, Bluefy Settings → "Enable BLE Advertisements" is ON, then reload.', 'err'); }, 20_000);
  } catch (e) { const se = classify(e); status(`[${se.kind}] ${se.message}`, 'err'); scanner = undefined; }
};
$('stop').onclick = () => { scanner?.stop(); scanner = undefined; status('Stopped'); $<HTMLButtonElement>('start').disabled = false; $<HTMLButtonElement>('stop').disabled = true; };
setInterval(() => map.render(store.list()), 10_000);
map.render(store.list());

let stopRadio: (() => void) | undefined;
$<HTMLInputElement>('radio').onchange = e => {
  if ((e.target as HTMLInputElement).checked) stopRadio = startMockRadioFeed(incs => map.renderIncidents(incs));
  else { stopRadio?.(); map.renderIncidents([]); }
};
