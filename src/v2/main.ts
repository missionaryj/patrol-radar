import './v2.css';
import { createScanner, match, pickDefaultBackend, isBluefy, classify, type Scanner, type BackendKind, type Match } from '../ble';
import { MapView, coarsen } from '../map';
import { LocalReportStore } from '../reports';
import { ScanStats } from '../ble/stats';
import { BluefyScanner } from '../ble/bluefyScanner';
import { NativeScanner, nativePlugin, type NativeScanMode } from '../ble/nativeScanner';
import { LiveDeviceTracker, colorFor, type LiveDevice } from '../map/liveDevices';
import { SessionRecorder } from '../recorder/recorder';
import { mountRecorder } from '../recorder/ui';
import { CrowdClient } from '../crowd/client';
import { PingGate, PingPlayer, soundEnabled, setSoundEnabled } from '../alert/ping';
import { probeReport, findScanApis } from '../ble/probe';
import { ScanSupervisor } from '../session/supervisor';
import { ScanFusion, wifiAsMatch, toWifiMatch } from '../session/extras';
import { NativeScanner as _NS } from '../ble/nativeScanner';
import { mountSegmented } from './segmented';
import { nativeAppPresent, applyPlatformSettings } from './platform';
import { mountUpdates } from './updatesUi';

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
// In the Android app the native scanner is the only sensible choice (background + Wi-Fi), so lock it and hide the picker.
// On the web, the Android-only scan-mode setting does nothing, so hide that instead.
const isNativeApp = nativeAppPresent();
sel.value = isNativeApp ? 'native' : new URLSearchParams(location.search).get('backend') ?? pickDefaultBackend();
applyPlatformSettings(document, isNativeApp);
{ const sm = document.getElementById('scanmode') as HTMLSelectElement | null; const v = localStorage.getItem('pr.scanmode'); if (sm && v) sm.value = v; }
{ const pl = nativePlugin(); const b = document.getElementById('battery') as HTMLButtonElement | null; if (pl && b) { b.hidden = false; b.onclick = () => pl.openBatterySettings(); } }
document.querySelectorAll<HTMLSelectElement>('select[data-seg]').forEach(mountSegmented);
if (sel.value === 'native') status('Android app: tap Scan. Scanning keeps running with the screen off (see the notification).', 'ok');
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
$('scrim').onclick = () => { setSettings(false); updatesUi.close(); };
const updatesUi = mountUpdates({ native: nativeAppPresent(), openSettings: () => setSettings(true) });
if (location.hash === '#settings') setSettings(true);
if (location.hash === '#sheet') sheet.classList.remove('collapsed');

// ---- location (precise = display only) ----
let geoWatch: number | undefined;
let here: { lat: number; lng: number } | undefined;
const live = new LiveDeviceTracker();
const visible = () => live.list().filter(d => d.kind === 'match' || (document.getElementById('showother') as HTMLInputElement | null)?.checked || scanner?.name?.toLowerCase().includes('bluefy'));
const drawLive = () => { liveLast = performance.now(); if (liveTimer !== undefined) { clearTimeout(liveTimer); liveTimer = undefined; } map.renderLive(visible(), here ?? pos); renderCards(); };
// Adverts arrive at up to thousands/min; redrawing every dot per advert janked the map. Coalesce to <= ~3 redraws/s.
let liveLast = 0; let liveTimer: number | undefined;
const drawLiveSoon = () => { if (liveTimer !== undefined) return; liveTimer = window.setTimeout(drawLive, Math.max(0, 300 - (performance.now() - liveLast))); };
setInterval(drawLive, 2000);
document.getElementById('showother')?.addEventListener('change', () => drawLive());
function startGeo() {
  if (!navigator.geolocation) { $('geo').textContent = 'Location unavailable'; return; }
  if (geoWatch !== undefined) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = navigator.geolocation.watchPosition(p => {
    map.setUserLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.coords.speed, p.coords.heading, p.timestamp);
    here = { lat: p.coords.latitude, lng: p.coords.longitude }; drawLive();
    recorder.fix(p.coords.accuracy, here);
    pos = coarsen(p.coords.latitude, p.coords.longitude);
    $('geo').textContent = `Location ±${Math.round(p.coords.accuracy)} m`;
  }, err => {
    recorder.event(err.code === err.PERMISSION_DENIED ? 'location-denied' : 'location-error', undefined, err.message);
    $('geo').textContent = err.code === err.PERMISSION_DENIED ? 'Location denied: allow it for this site, then tap ◎' : `Location error: ${err.message}`;
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 });
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
  const devs = visible().sort((a, b) => (a.kind === b.kind ? b.lastSeen - a.lastSeen : a.kind === 'match' ? -1 : 1));
  const ul = $('cards');
  const n: Record<string, number> = { axon: 0, moto: 0, other: 0, unk: 0 };
  devs.forEach(d => { n[badgeFor(d, matches.get(d.key)).cls]++; });
  for (const k in n) { const el = document.getElementById(`n-${k}`); if (el) el.textContent = String(n[k]); }
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
  void ping.unlock(); pingGate.reset();
  const kind = sel.value as BackendKind;
  if (kind !== 'native') recorder.event(scanner ? 'restart' : 'start', kind); scanner = createScanner(kind); stats.reset(); $('d-backend').textContent = kind; $('d-mode').textContent = '-';
  if (!(await scanner.isSupported())) {
    scanner = undefined;
    status(kind === 'mock' ? 'Mock unavailable?' : 'No Web Bluetooth in this browser. On iPhone use Bluefy; on Android use Chrome. Or pick Mock in Settings.', 'err'); return;
  }
  status(kind === 'bluefy' ? 'Pick a device to watch in the Bluefy list. Use ＋ to watch more (iOS has no all-devices scan).' : 'Starting…', '', 'Starting');
  if (scanner instanceof BluefyScanner) {
    scanner.pickerMode = picker.value as 'police' | 'all'; scanner.notice = msg => status(msg);
    scanner.onChange = n => { $('d-mode').textContent = `per-device watchAdvertisements · watching ${n} device(s)`; };
  }
  if (scanner instanceof NativeScanner) {
    const sm = $<HTMLSelectElement>('scanmode'); scanner.mode = sm.value as NativeScanMode; localStorage.setItem('pr.scanmode', sm.value);
    scanner.filtered = picker.value !== 'all';
    // Record the filter so a debug file with 0 adverts says whether only police gear was being listened for.
    recorder.event('start', kind, `native ${scanner.mode} · ${scanner.filtered ? 'police filters (hardware: only police-gear adverts are delivered)' : 'all devices'}`);
    scanner.onError = msg => { recorder.event('error', kind, `native: ${msg}`); scanner = undefined; live.clear(); drawLive(); setScanning(false); status(`[scan] ${msg}`, 'err'); };
  }
  if (scanner instanceof _NS) scanner.onWifi = nm => onWifi(nm);
  try {
    let advCb: (adv: any) => void;
    await scanner.start(advCb = adv => {
      supervisor.advert();
      const m0 = match(adv); const fz = m0 ? fusion.ble(m0, pos) : null; const m = m0 && ScanFusion.boostFlock(m0, fz); if (fz) patrolFlag(fz, pos); recorder.add(adv, m, pos); stats.record(!!m); allDevs.add(adv.sessionId); if (m) { policeDevs.add(adv.sessionId); matches.set(adv.sessionId, m); }
      const isNew = !live.has(adv.sessionId);
      live.update(adv.sessionId, adv.rssi, m); drawLiveSoon();
      if (!m) { if (isNew && kind === 'bluefy') logLine(`${new Date().toLocaleTimeString()} · picked: ${picker.value === 'police' ? 'matched a police-gear filter; waiting for first advert to identify type' : 'unknown device (no police signature yet)'} · session ${adv.sessionId}`, '#8a9bb0'); return; }
      if (Date.now() - (lastSeen.get(m.sessionId) ?? 0) < 30_000) return;
      lastSeen.set(m.sessionId, Date.now());
      if (kind !== 'mock' && m.signature.category !== 'fixed') void crowd.report({ kind: m.signature.category, confidence: m.confidence, time: m.timestamp }, pos);
      const loc = kind === 'mock' ? jitterDemo() : pos; // coarse grid only
      store.add({ id: crypto.randomUUID(), category: m.signature.category, label: m.signature.label, confidence: m.confidence, ...loc, timestamp: m.timestamp });
      logLine(`${new Date(m.timestamp).toLocaleTimeString()} · ${m.signature.label} · ${(m.confidence * 100).toFixed(0)}%${m.corroborated ? ' (2 signals agree)' : ''} · RSSI ${m.rssi ?? '?'} · session ${m.sessionId} (${m.signature.status})`, colorFor(m));
      map.render(store.list());
      firePing(m, loc);
    });
    void supervisor.started(kind, scanner, advCb);
    map.follow.resume();
    $('d-mode').textContent = (scanner as any).mode || scanner.name;
    status(`Scanning (${scanner.name}). Watch "adverts seen" in Debug: if it stays 0 for 30 s with Bluetooth devices around, scanning is not working.`, 'ok');
    setScanning(true); $('add').hidden = !(scanner instanceof BluefyScanner);
    setTimeout(() => {
      if (!scanner || stats.raw !== 0 || kind === 'mock') return;
      if (kind === 'native' && picker.value !== 'all') status('No police gear heard in 20 s. "Police gear only" ignores phones, earbuds and cars, so 0 is normal with no police nearby. To test that scanning works, set Devices to "All devices" in Settings.', '');
      else status('No advertisements received in 20 s. The device may not be advertising; pick another, or check Debug in Settings.', 'err');
    }, 20_000);
  } catch (e) { scanner = undefined; setScanning(false); const se = classify(e); recorder.event(/permission|denied|notallowed/i.test(se.kind + se.message) ? 'permission-denied' : 'error', kind, `${se.kind}: ${se.message}`); status(`[${se.kind}] ${se.message}`, 'err'); }
}
function stop() { supervisor.stopped(); fusion.fusion.clear(); $('add').hidden = true; live.clear(); matches.clear(); if (scanner) recorder.event('stop', sel.value); scanner?.stop(); scanner = undefined; drawLive(); setScanning(false); status('Stopped'); }
$('scan').onclick = () => (scanner ? stop() : start());
// Native filter / scan mode are only read at start: apply a change made while scanning by restarting the scan.
for (const id of ['picker', 'scanmode']) document.getElementById(id)?.addEventListener('change', () => {
  if (scanner instanceof NativeScanner) { recorder.event('restart', sel.value, `${id} changed to ${(document.getElementById(id) as HTMLSelectElement).value}`); stop(); void start(); }
});
$('add').onclick = async () => {
  if (!(scanner instanceof BluefyScanner)) return;
  scanner.pickerMode = picker.value as 'police' | 'all';
  try { await scanner.addDevice(); status(`Watching ${scanner.count} device(s).`, 'ok'); }
  catch (e) { const se = classify(e); status(`[${se.kind}] ${se.message}`, 'err'); }
};
setInterval(() => map.render(store.list()), 10_000);
map.render(store.list());

if (new URLSearchParams(location.search).get('autostart') === '1') setTimeout(start, 0);

const recorder = new SessionRecorder();
const recHost = document.createElement('div'); document.querySelector('.sheet-head')!.after(recHost);
mountRecorder(recHost, recorder, () => sel.value);
document.addEventListener('visibilitychange', () => { if (document.hidden) recorder.flush(); });
addEventListener('pagehide', () => recorder.flush());

// ---- crowd map (opt-in sharing; public layer is aggregated + delayed server-side) ----
const crowd = new CrowdClient();
const shareBox = $<HTMLInputElement>('crowdshare'); shareBox.checked = crowd.sharing;
shareBox.onchange = () => { crowd.sharing = shareBox.checked; toast(shareBox.checked ? 'Sharing coarse police-gear hits to the crowd map' : 'Crowd sharing off'); };
$<HTMLInputElement>('crowd').onchange = e => map.showCrowd((e.target as HTMLInputElement).checked);
async function pollCrowd() {
  try { const cells = await crowd.cells(); map.renderCrowd(cells); const conf = cells.filter(c => c.confirmed).length;
    $('crowd-status').textContent = `${cells.length} crowd area(s) · ${conf} confirmed · updated ${new Date().toLocaleTimeString()}`; }
  catch (e) { $('crowd-status').textContent = `Crowd map unavailable (${(e as Error).message})`; }
}
pollCrowd(); setInterval(pollCrowd, 90_000);

// ---- police ping (audio alert on NEW police-gear match) ----
const ping = new PingPlayer(), pingGate = new PingGate();
const soundBox = $<HTMLInputElement>('sound'); soundBox.checked = soundEnabled();
soundBox.onchange = () => { setSoundEnabled(soundBox.checked); if (soundBox.checked) { void ping.unlock().then(() => ping.play('soft')); } };
function firePing(m: Match, loc: { lat: number; lng: number }) {
  const c = coarsen(loc.lat, loc.lng); const level = pingGate.check({ deviceKey: m.sessionId, cell: `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`, category: m.signature.category, matched: true });
  if (!level) return;
  toast(`🔔 Police gear nearby: ${m.signature.label} (${(m.confidence * 100).toFixed(0)}%)`);
  document.body.classList.add('pinging'); setTimeout(() => document.body.classList.remove('pinging'), 2500);
  if (!soundEnabled()) return;
  const pl = nativePlugin();
  if (pl && document.hidden) { void pl.alert?.({ title: 'Police gear nearby', text: m.signature.label, soft: level === 'soft' }).catch(() => {}); return; }
  ping.play(level);
}

// ---- scan supervisor (stall watchdog + wake lock), Wi-Fi rules, patrol-car fusion, follow-me, Flock layer ----
const supervisor = new ScanSupervisor({ recorder, warn: (msg, err) => (err ? status(msg, 'err') : status(msg, 'ok')) });
const fusion = new ScanFusion();
const addLog = (text: string, color: string) => logLine(text, color);
function patrolFlag(f: { possiblePatrolCar: boolean; gearTypes: string[] }, loc: { lat: number; lng: number }) {
  if (!f.possiblePatrolCar) return; const c = coarsen(loc.lat, loc.lng); const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
  if (!fusion.fusion.shouldAlert(key, Date.now())) return;
  recorder.event('possible-patrol-car', sel.value, f.gearTypes.join('+'));
  store.add({ id: crypto.randomUUID(), category: 'vehicle', label: `Possible patrol car (${f.gearTypes.join(' + ')})`, confidence: 0.8, ...c, timestamp: Date.now() });
  map.render(store.list());
  addLog(`${new Date().toLocaleTimeString()} · 🚓 Possible patrol car: ${f.gearTypes.join(' + ')} in the same ~150 m area within 30 s`, '#ff1744');
  status(`🚓 Possible patrol car nearby (${f.gearTypes.join(' + ')})`, 'ok');
}
function onWifi(nm: import('../ble/nativeScanner').NativeWifiMatch) {
  const w = toWifiMatch(nm); if (!w) return;
  recorder.addWifi(w, nm.rssi, pos);
  const m = wifiAsMatch(w, nm); const f = fusion.wifi(w, pos); if (f) patrolFlag(f, pos);
  live.update(m.sessionId, m.rssi, m); drawLiveSoon();
  if (Date.now() - (lastSeen.get(m.sessionId) ?? 0) < 30_000) return; lastSeen.set(m.sessionId, Date.now());
  store.add({ id: crypto.randomUUID(), category: m.signature.category, label: m.signature.label, confidence: m.confidence, ...pos, timestamp: m.timestamp });
  map.render(store.list());
  addLog(`${new Date(m.timestamp).toLocaleTimeString()} · ${m.signature.label} · ${(m.confidence * 100).toFixed(0)}% · RSSI ${m.rssi ?? '?'} (unverified)`, colorFor(m));
}
// Follow-me: on by default; a manual pan pauses it and the recenter button resumes it.
{ const rb = document.getElementById('recenter'); map.onFollowChange = on => { rb?.classList.toggle('follow-paused', !on); if (rb) rb.title = on ? 'Following your location' : 'Recenter and follow'; }; }
// Pre-loaded Flock cameras from OpenStreetMap (separate from scan hits).
const FLOCK_URL = `${import.meta.env.BASE_URL}data/flock/`;
{ const fb = document.getElementById('flockmap') as HTMLInputElement | null; const fs = document.getElementById('flock-status');
  const setFlock = (on: boolean) => { localStorage.setItem('pr.flockmap', on ? '1' : '0');
    map.showFlock(on, FLOCK_URL).then(() => { const i = map.flockInfo; if (fs && i) fs.textContent = `${i.count.toLocaleString()} mapped US Flock cameras · OSM data as of ${i.osmBase?.slice(0, 10) ?? '?'} · zoom in to see them`; })
      .catch(e => { if (fs) fs.textContent = `Flock layer unavailable (${(e as Error).message})`; }); };
  const on = localStorage.getItem('pr.flockmap') !== '0'; if (fb) { fb.checked = on; fb.onchange = () => setFlock(fb.checked); } setFlock(on); }
import { mountCityChat } from './cityChat';
mountCityChat(() => (here ? pos : undefined)); // coarse cell only; `here` is just the has-a-fix flag
