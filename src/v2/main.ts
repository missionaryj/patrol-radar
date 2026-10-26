import './v2.css';
import { createScanner, match, pickDefaultBackend, isBluefy, classify, type Scanner, type BackendKind, type Match } from '../ble';
import { MapView, coarsen } from '../map';
import { LocalReportStore } from '../reports';
import { startMockRadioFeed } from '../radio/mockFeed';
import { ScanStats } from '../ble/stats';
import { BluefyScanner } from '../ble/bluefyScanner';
import { LiveDeviceTracker, colorFor, type LiveDevice } from '../map/liveDevices';
import { probeReport, findScanApis } from '../ble/probe';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const store = new LocalReportStore();
const map = new MapView($('map'), undefined, { dark: true, legend: false, layersControl: false, zoomControl: false });
let pos = { lat: 41.88, lng: -87.63 };
let scanner: Scanner | undefined;
const lastSeen = new Map<string, number>();
const stats = new ScanStats();
const allDevs = new Set<string>(), policeDevs = new Set<string>();
const matches = new Map<string, Match>(); // latest match per session id (display only)

type State = 'idle' | 'scan' | 'err';
function status(msg: string, cls: '' | 'ok' | 'err' = '', short?: string) {
  $('status-full').textContent = msg; $('status-full').className = 'status-full ' + cls;
  const st: State = cls === 'err' ? 'err' : scanner ? 'scan' : 'idle';
  $('pill').className = 'pill ' + st;
  $('pill-text').textContent = short ?? (st === 'err' ? 'Error' : st === 'scan' ? 'Scanning' : 'Idle');
  if (cls === 'err' || (msg.length > 0 && cls !== 'ok' && msg !== 'Idle' && msg !== 'Stopped')) toast(msg, cls === 'err');
}
let toastT: number | undefined;
function toast(msg: string, err = false) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = window.setTimeout(() => { t.hidden = true; }, err ? 12_000 : 6_000);
}
$('toast').onclick = () => { $('toast').hidden = true; };

function renderStats() {
  $('d-raw').textContent = String(stats.raw); $('d-unmatched').textContent = String(stats.unmatched); $('d-matched').textContent = String(stats.matched);
  $('d-devs').textContent = String(allDevs.size); $('d-pdevs').textContent = String(policeDevs.size); $('pill-count').textContent = String(policeDevs.size);
  $('d-last').textContent = stats.lastAt ? `${Math.round((Date.now() - stats.lastAt) / 1000)}s ago` : 'never';
}
setInterval(renderStats, 1000);

const bt = (navigator as any).bluetooth;
$('d-env').textContent = `navigator.bluetooth: ${bt ? 'yes' : 'no'} · requestLEScan: ${typeof bt?.requestLEScan === 'function'} · scan/advert APIs: ${findScanApis().map(f => f.path).join(', ') || 'none'} · device.watchAdvertisements: ${typeof (window as any).BluetoothDevice?.prototype?.watchAdvertisements === 'function'} · secure: ${window.isSecureContext} · bluefy: ${isBluefy()}`;
$('d-probe').textContent = probeReport();
const sel = $<HTMLSelectElement>('backend');
const picker = $<HTMLSelectElement>('picker');
sel.value = new URLSearchParams(location.search).get('backend') ?? pickDefaultBackend();
if (sel.value === 'bluefy') status('Bluefy detected; Bluefy backend selected. Tap Scan.', 'ok');

// ---- sheets ----
const sheet = $('sheet');
$('sheet-handle').onclick = () => sheet.classList.toggle('collapsed');
let y0: number | undefined;
sheet.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
sheet.addEventListener('touchend', e => { if (y0 === undefined) return; const dy = e.changedTouches[0].clientY - y0; y0 = undefined;
  if (dy < -40) sheet.classList.remove('collapsed'); else if (dy > 40 && ($('cards').scrollTop <= 0)) sheet.classList.add('collapsed'); });
const setSettings = (open: boolean) => { $('settings').classList.toggle('open', open); $('settings').setAttribute('aria-hidden', String(!open)); $('scrim').hidden = !open; };
$('open-settings').onclick = () => setSettings(true);
$('close-settings').onclick = () => setSettings(false);
$('scrim').onclick = () => setSettings(false);
if (location.hash === '#settings') setSettings(true);
if (location.hash === '#sheet') sheet.classList.remove('collapsed');

// ---- location (precise = display only) ----
let geoWatch: number | undefined;
let here: { lat: number; lng: number } | undefined;
const live = new LiveDeviceTracker();
const drawLive = () => { map.renderLive(live.list(), here ?? pos); renderCards(); };
setInterval(drawLive, 2000);
function startGeo() {
  if (!navigator.geolocation) { $('geo').textContent = 'Location unavailable'; return; }
  if (geoWatch !== undefined) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = navigator.geolocation.watchPosition(p => {
    map.setUserLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
    here = { lat: p.coords.latitude, lng: p.coords.longitude }; drawLive();
    pos = coarsen(p.coords.latitude, p.coords.longitude);
    $('geo').textContent = `Location ±${Math.round(p.coords.accuracy)} m`;
  }, err => {
    $('geo').textContent = err.code === err.PERMISSION_DENIED ? 'Location denied: allow it for this site, then tap ◎' : `Location error: ${err.message}`;
  }, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 });
}
startGeo();
$('recenter').onclick = () => { if (!map.recenter()) startGeo(); };
const jitterDemo = () => coarsen(pos.lat + (Math.random() - 0.5) * 0.01, pos.lng + (Math.random() - 0.5) * 0.01);

// ---- cards ----
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 5 ? 'now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; };
function badgeFor(d: LiveDevice, m?: Match) {
  if (d.kind !== 'match' || !m) return { cls: 'unk', text: 'Unknown' };
  const c = colorFor(m);
  return c === '#e53935' ? { cls: 'axon', text: m.signature.vendor === 'Axon' ? 'Axon' : 'Body cam' } : c === '#fb8c00' ? { cls: 'moto', text: 'Motorola' } : { cls: 'other', text: 'Other' };
}
function renderCards() {
  const devs = live.list().sort((a, b) => (a.kind === b.kind ? b.lastSeen - a.lastSeen : a.kind === 'match' ? -1 : 1));
  const ul = $('cards');
  if (!devs.length) { ul.innerHTML = `<li class="empty">${scanner ? 'Listening… nothing nearby yet.' : 'No detections yet. Tap <b>Scan</b> to start listening.'}</li>`; return; }
  ul.innerHTML = devs.map(d => {
    const m = matches.get(d.key); const b = badgeFor(d, m); const conf = d.confidence ?? 0; const stale = Date.now() - d.lastSeen > 30_000;
    return `<li class="card${stale ? ' stale' : ''}" style="--c:${d.color}">
      <div class="row"><span class="badge ${b.cls}">${b.text}</span><span class="name">${esc(d.label)}</span><span class="ago">${ago(d.lastSeen)}</span></div>
      ${d.kind === 'match' ? `<div class="conf"><div class="bar"><i style="width:${Math.round(conf * 100)}%"></i></div><b>${Math.round(conf * 100)}%</b></div>` : ''}
      <div class="row meta"><span class="prox ${d.band}">${d.band}</span><span>RSSI ${d.rssi}</span>${m?.corroborated ? '<span class="tag">2 signals agree</span>' : ''}${m ? `<span class="muted">${m.signature.status}</span>` : ''}<span class="sid">#${esc(d.key.slice(0, 6))}</span></div>
    </li>`;
  }).join('');
}

// ---- scan ----
function logLine(text: string, color: string) { const li = document.createElement('li'); li.style.borderColor = color; li.textContent = text; $('log').prepend(li); }
function setScanning(on: boolean) {
  const b = $<HTMLButtonElement>('scan'); b.classList.toggle('on', on); $('scan-label').textContent = on ? 'Stop' : 'Scan'; b.setAttribute('aria-label', on ? 'Stop scan' : 'Start scan');
}
async function start() {
  const kind = sel.value as BackendKind;
  scanner = createScanner(kind); stats.reset(); $('d-backend').textContent = kind; $('d-mode').textContent = '-';
  if (!(await scanner.isSupported())) {
    scanner = undefined;
    status(kind === 'mock' ? 'Mock unavailable?' : 'No Web Bluetooth in this browser. On iPhone use Bluefy; on Android use Chrome. Or pick Mock in Settings.', 'err'); return;
  }
  status(kind === 'bluefy' ? 'Pick a device to watch in the Bluefy list. Use ＋ to watch more (iOS has no all-devices scan).' : 'Starting…', '', 'Starting');
  if (scanner instanceof BluefyScanner) {
    scanner.pickerMode = picker.value as 'police' | 'all'; scanner.notice = msg => status(msg);
    scanner.onChange = n => { $('d-mode').textContent = `per-device watchAdvertisements · watching ${n} device(s)`; };
  }
  try {
    await scanner.start(adv => {
      const m = match(adv); stats.record(!!m); allDevs.add(adv.sessionId); if (m) { policeDevs.add(adv.sessionId); matches.set(adv.sessionId, m); }
      const isNew = !live.has(adv.sessionId);
      live.update(adv.sessionId, adv.rssi, m); drawLive();
      if (!m) { if (isNew && kind === 'bluefy') logLine(`${new Date().toLocaleTimeString()} · picked: ${picker.value === 'police' ? 'matched a police-gear filter; waiting for first advert to identify type' : 'unknown device (no police signature yet)'} · session ${adv.sessionId}`, '#8a9bb0'); return; }
      if (Date.now() - (lastSeen.get(m.sessionId) ?? 0) < 30_000) return;
      lastSeen.set(m.sessionId, Date.now());
      const loc = kind === 'mock' ? jitterDemo() : pos; // coarse grid only
      store.add({ id: crypto.randomUUID(), category: m.signature.category, label: m.signature.label, confidence: m.confidence, ...loc, timestamp: m.timestamp });
      logLine(`${new Date(m.timestamp).toLocaleTimeString()} · ${m.signature.label} · ${(m.confidence * 100).toFixed(0)}%${m.corroborated ? ' (2 signals agree)' : ''} · RSSI ${m.rssi ?? '?'} · session ${m.sessionId} (${m.signature.status})`, colorFor(m));
      map.render(store.list());
    });
    $('d-mode').textContent = (scanner as any).mode || scanner.name;
    status(`Scanning (${scanner.name}). Watch "adverts seen" in Debug: if it stays 0 for 30 s with Bluetooth devices around, scanning is not working.`, 'ok');
    setScanning(true); $('add').hidden = !(scanner instanceof BluefyScanner);
    setTimeout(() => { if (scanner && stats.raw === 0 && kind !== 'mock') status('No advertisements received in 20 s. The device may not be advertising; pick another, or check Debug in Settings.', 'err'); }, 20_000);
  } catch (e) { scanner = undefined; setScanning(false); const se = classify(e); status(`[${se.kind}] ${se.message}`, 'err'); }
}
function stop() { $('add').hidden = true; live.clear(); matches.clear(); scanner?.stop(); scanner = undefined; drawLive(); setScanning(false); status('Stopped'); }
$('scan').onclick = () => (scanner ? stop() : start());
$('add').onclick = async () => {
  if (!(scanner instanceof BluefyScanner)) return;
  scanner.pickerMode = picker.value as 'police' | 'all';
  try { await scanner.addDevice(); status(`Watching ${scanner.count} device(s).`, 'ok'); }
  catch (e) { const se = classify(e); status(`[${se.kind}] ${se.message}`, 'err'); }
};
setInterval(() => map.render(store.list()), 10_000);
map.render(store.list());

let stopRadio: (() => void) | undefined;
$<HTMLInputElement>('radio').onchange = e => {
  if ((e.target as HTMLInputElement).checked) stopRadio = startMockRadioFeed(incs => map.renderIncidents(incs));
  else { stopRadio?.(); map.renderIncidents([]); }
};
if (new URLSearchParams(location.search).get('autostart') === '1') start();
