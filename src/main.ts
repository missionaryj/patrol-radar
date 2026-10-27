import { PingGate, PingPlayer, soundEnabled, setSoundEnabled } from './alert/ping';
import './style.css';
// In the Android app, open the v2 UI.
if ((globalThis as any).Capacitor?.isNativePlatform?.()) location.replace('v2/index.html');
import { createScanner, match, pickDefaultBackend, isBluefy, classify, type Scanner, type BackendKind } from './ble';
import { MapView, coarsen } from './map';
import { LocalReportStore } from './reports';
import { startMockRadioFeed } from './radio/mockFeed';
import { ScanStats } from './ble/stats';
import { BluefyScanner } from './ble/bluefyScanner';
import { LiveDeviceTracker, colorFor } from './map/liveDevices';
import { SessionRecorder } from './recorder/recorder';
import { mountRecorder } from './recorder/ui';
import { probeReport, findScanApis } from './ble/probe';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const store = new LocalReportStore();
const map = new MapView($('map'));
let pos = { lat: 41.88, lng: -87.63 };
let scanner: Scanner | undefined;
const lastSeen = new Map<string, number>();
const stats = new ScanStats();
const allDevs = new Set<string>(), policeDevs = new Set<string>();

function status(msg: string, cls: '' | 'ok' | 'err' = '') { const s = $('status'); s.textContent = msg; s.className = cls; }
function renderStats() {
  $('d-raw').textContent = String(stats.raw); $('d-unmatched').textContent = String(stats.unmatched); $('d-matched').textContent = String(stats.matched); $('d-devs').textContent = String(allDevs.size); $('d-pdevs').textContent = String(policeDevs.size);
  $('d-last').textContent = stats.lastAt ? `${Math.round((Date.now() - stats.lastAt) / 1000)}s ago` : 'never';
}
setInterval(renderStats, 1000);

const bt = (navigator as any).bluetooth;
$('d-env').textContent = `navigator.bluetooth: ${bt ? 'yes' : 'no'} · requestLEScan: ${typeof bt?.requestLEScan === 'function'} · scan/advert APIs: ${findScanApis().map(f => f.path).join(', ') || 'none'} · device.watchAdvertisements: ${typeof (window as any).BluetoothDevice?.prototype?.watchAdvertisements === 'function'} · secure: ${window.isSecureContext} · bluefy: ${isBluefy()}`;
$('d-probe').textContent = probeReport();
const sel = $<HTMLSelectElement>('backend');
sel.value = pickDefaultBackend();
if (sel.value === 'bluefy') status('Bluefy detected; Bluefy backend selected. Tap Start scan.', 'ok');

let geoWatch: number | undefined;
let here: { lat: number; lng: number } | undefined; // precise, in-memory, display-only
const live = new LiveDeviceTracker();
const visible = () => live.list().filter(d => d.kind === 'match' || (document.getElementById('showother') as HTMLInputElement | null)?.checked || scanner?.name?.toLowerCase().includes('bluefy'));
const drawLive = () => map.renderLive(visible(), here ?? pos);
setInterval(drawLive, 2000);
document.getElementById('showother')?.addEventListener('change', () => drawLive());
function startGeo() {
  if (!navigator.geolocation) { $('geo').textContent = 'Location unavailable'; return; }
  if (geoWatch !== undefined) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = navigator.geolocation.watchPosition(p => {
    // precise position: display only (map dot); never stored/logged/reported
    map.setUserLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
    here = { lat: p.coords.latitude, lng: p.coords.longitude }; drawLive();
    pos = coarsen(p.coords.latitude, p.coords.longitude); // reports use the coarse grid only
    $('geo').textContent = `Location ±${Math.round(p.coords.accuracy)} m`;
  }, err => {
    $('geo').textContent = err.code === err.PERMISSION_DENIED
      ? 'Location denied: map stays at default. Allow location for this site (Bluefy/iOS Settings → Privacy → Location), then tap ◎.'
      : `Location error: ${err.message}`;
  }, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 });
}
startGeo();
$('recenter').onclick = () => { if (!map.recenter()) startGeo(); };
const jitterDemo = () => coarsen(pos.lat + (Math.random() - 0.5) * 0.01, pos.lng + (Math.random() - 0.5) * 0.01);

$('start').onclick = async () => {
  void ping.unlock(); pingGate.reset();
  const kind = sel.value as BackendKind;
  scanner = createScanner(kind); stats.reset(); $('d-backend').textContent = kind; $('d-mode').textContent = '-';
  if (!(await scanner.isSupported())) {
    status(kind === 'mock' ? 'Mock unavailable?' : 'No Web Bluetooth in this browser. On iPhone use the Bluefy browser; on Android use Chrome. Or pick Mock.', 'err'); return;
  }
  status(kind === 'bluefy' ? 'Pick a device to watch: choose one in the Bluefy list. Use “+ Pick another device” to watch more (iOS has no all-devices scan).' : 'Starting…');
  if (scanner instanceof BluefyScanner) { scanner.pickerMode = $<HTMLSelectElement>('picker').value as 'police' | 'all'; scanner.notice = msg => status(msg); }
  if (scanner instanceof BluefyScanner) scanner.onChange = n => { $('d-mode').textContent = `per-device watchAdvertisements · watching ${n} device(s)`; };
  try {
    await scanner.start(adv => {
      const m = match(adv); recorder.add(adv, m, pos); stats.record(!!m); allDevs.add(adv.sessionId); if (m) policeDevs.add(adv.sessionId);
      const isNew = !live.has(adv.sessionId);
      live.update(adv.sessionId, adv.rssi, m); drawLive();
      if (!m) { if (isNew && kind === 'bluefy') { const li = document.createElement('li'); li.style.borderColor = '#8a9bb0'; li.textContent = `${new Date().toLocaleTimeString()} · picked: ${$<HTMLSelectElement>('picker').value === 'police' ? 'matched a police-gear filter; waiting for first advert to identify type' : 'unknown device (no police signature yet)'} · session ${adv.sessionId}`; $('log').prepend(li); } return; }
      if (Date.now() - (lastSeen.get(m.sessionId) ?? 0) < 30_000) return;
      lastSeen.set(m.sessionId, Date.now());
      const loc = kind === 'mock' ? jitterDemo() : pos;
      store.add({ id: crypto.randomUUID(), category: m.signature.category, label: m.signature.label, confidence: m.confidence, ...loc, timestamp: m.timestamp });
      const li = document.createElement('li');
      li.style.borderColor = colorFor(m); li.textContent = `${new Date(m.timestamp).toLocaleTimeString()} · ${m.signature.label} · ${(m.confidence * 100).toFixed(0)}%${m.corroborated ? ' (2 signals agree)' : ''} · RSSI ${m.rssi ?? '?'} · session ${m.sessionId} (${m.signature.status})`;
      $('log').prepend(li); map.render(store.list());
      { const c = coarsen(loc.lat, loc.lng); const lv = pingGate.check({ deviceKey: m.sessionId, cell: `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`, category: m.signature.category, matched: true });
        if (lv) { status(`🔔 Police gear nearby: ${m.signature.label}`, 'ok'); if (soundEnabled()) ping.play(lv); } }
    });
    $('d-mode').textContent = (scanner as any).mode || scanner.name;
    status(`Scanning (${scanner.name}). Watch "adverts seen" in Debug: if it stays 0 for 30 s with Bluetooth devices around, scanning is not working.`, 'ok');
    $<HTMLButtonElement>('start').disabled = true; $<HTMLButtonElement>('stop').disabled = false;
    $('add').hidden = !(scanner instanceof BluefyScanner);
    setTimeout(() => { if (scanner && stats.raw === 0 && kind !== 'mock') status('No advertisements received in 20 s from the watched device(s). The device may not be advertising; pick another, or check the API debug list.', 'err'); }, 20_000);
  } catch (e) { const se = classify(e); status(`[${se.kind}] ${se.message}`, 'err'); scanner = undefined; }
};
$('add').onclick = async () => {
  if (!(scanner instanceof BluefyScanner)) return;
  scanner.pickerMode = $<HTMLSelectElement>('picker').value as 'police' | 'all';
  try { await scanner.addDevice(); status(`Watching ${scanner.count} device(s).`, 'ok'); }
  catch (e) { const se = classify(e); status(`[${se.kind}] ${se.message}`, 'err'); }
};
$('stop').onclick = () => { $('add').hidden = true; live.clear(); drawLive(); scanner?.stop(); scanner = undefined; status('Stopped'); $<HTMLButtonElement>('start').disabled = false; $<HTMLButtonElement>('stop').disabled = true; };
setInterval(() => map.render(store.list()), 10_000);
map.render(store.list());

let stopRadio: (() => void) | undefined;
$<HTMLInputElement>('radio').onchange = e => {
  if ((e.target as HTMLInputElement).checked) stopRadio = startMockRadioFeed(incs => map.renderIncidents(incs));
  else { stopRadio?.(); map.renderIncidents([]); }
};

const recorder = new SessionRecorder();
const recHost = document.getElementById('start')!.parentElement!;
mountRecorder(recHost, recorder, () => sel.value);

const ping = new PingPlayer(), pingGate = new PingGate();
const soundBox = document.getElementById('sound') as HTMLInputElement; soundBox.checked = soundEnabled();
soundBox.onchange = () => { setSoundEnabled(soundBox.checked); if (soundBox.checked) void ping.unlock().then(() => ping.play('soft')); };
