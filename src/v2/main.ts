import { mountMapSettings } from '../settings/mapSettings';
import './v2.css';
import { createScanner, match, pickDefaultBackend, isBluefy, classify, type Scanner, type BackendKind, type Match } from '../ble';
import { MapView, coarsen } from '../map';
import { LocalReportStore } from '../reports';
import { ScanStats } from '../ble/stats';
import { BluefyScanner } from '../ble/bluefyScanner';
import { NativeScanner, nativePlugin, type NativeScanMode } from '../ble/nativeScanner';
import { LiveDeviceTracker, colorFor, WIFI_COLOR, bandRadius, type LiveDevice } from '../map/liveDevices';
import { corroborationText, type Vehicle } from '../fusion/vehicles';
import { bandOfMHz } from '../wifi/context';
import { SessionRecorder } from '../recorder/recorder';
import { mountRecorder } from '../recorder/ui';
import { CrowdClient } from '../crowd/client';
import { TrafficAlerter, loadTcSettings, saveTcSettings, alertsFor, roundDist, type AlertDistance, type AlertStyle, type Fix, type TcAlert } from '../alert/trafficAlerts';
import { TC_META, TC_TYPES, tcIcon } from '../map/trafficCamLayer';
import { travel } from '../settings/travelMode';
import { PingGate, PingPlayer, soundEnabled, setSoundEnabled } from '../alert/ping';
import { probeReport, findScanApis } from '../ble/probe';
import { ScanSupervisor } from '../session/supervisor';
import { ScanFusion, wifiAsMatch, toWifiMatch } from '../session/extras';
import { NativeScanner as _NS } from '../ble/nativeScanner';
import { mountSegmented } from './segmented';
import { nativeAppPresent, applyPlatformSettings } from './platform';
import { mountUpdates } from './updatesUi';
import { mountLegend } from '../map/legend';
import { type HeatFilter, type StopHeatIndex, heatPaint } from '../map/stopHeatLayer';

const fusion = new ScanFusion();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const store = new LocalReportStore();
mountLegend($('map-legend'));
const map = new MapView($('map'), undefined, { dark: true, legend: false, layersControl: false, zoomControl: false });
mountMapSettings(map);
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
const drawLive = () => { liveLast = performance.now(); if (liveTimer !== undefined) { clearTimeout(liveTimer); liveTimer = undefined; } map.renderLive(visible(), here ?? pos, Date.now(), fusion.vehicles.list()); renderCards(); };
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
    void checkTrafficCams({ lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed, heading: p.coords.heading, t: p.timestamp });
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
  if (m.radio === 'wifi') return { cls: 'wifi', text: '📶 Wi-Fi' };
  const c = colorFor(m);
  return c === '#e53935' ? { cls: 'axon', text: m.signature.vendor === 'Axon' ? 'Axon' : 'Body cam' } : c === '#fb8c00' ? { cls: 'moto', text: 'Motorola' } : { cls: 'other', text: 'Other' };
}
const gradeOf = (c: number) => (c >= 0.85 ? 'strong' : c >= 0.5 ? 'likely' : 'hint');
function renderCards() {
  const devs = visible().sort((a, b) => (a.kind === b.kind ? b.lastSeen - a.lastSeen : a.kind === 'match' ? -1 : 1));
  const ul = $('cards');
  const n: Record<string, number> = { axon: 0, moto: 0, other: 0, unk: 0, wifi: 0 };
  devs.forEach(d => { n[badgeFor(d, matches.get(d.key)).cls]++; });
  for (const k in n) { const el = document.getElementById(`n-${k}`); if (el) el.textContent = String(n[k]); }
  // Grouped vehicles show as one card; their member signals are listed inside it instead of as separate cards.
  const vehicles = fusion.vehicles.list(); const grouped = new Set(vehicles.flatMap(v => v.members.map(m => m.key)));
  const solo = devs.filter(d => !grouped.has(d.key));
  if (!devs.length && !vehicles.length) { ul.innerHTML = `<li class="empty">${scanner ? 'Listening… nothing nearby yet.' : 'No detections yet. Tap <b>Scan</b> to start listening.'}</li>`; return; }
  ul.innerHTML = vehicles.map(vehicleCard).join('') + solo.map(d => {
    const m = matches.get(d.key); const b = badgeFor(d, m); const conf = d.confidence ?? 0; const stale = Date.now() - d.lastSeen > 30_000;
    const wifi = d.radio === 'wifi';
    return `<li class="card${stale ? ' stale' : ''}${wifi ? ' wifi' : ''}" style="--c:${wifi ? WIFI_COLOR : d.color}">
      <div class="row"><span class="badge ${b.cls}">${b.text}</span><span class="name">${esc(d.label)}</span><span class="ago">${ago(d.lastSeen)}</span></div>
      ${d.kind === 'match' ? `<div class="conf"><span class="grade">${gradeOf(conf)}</span><div class="bar"><i style="width:${Math.round(conf * 100)}%"></i></div><b>${Math.round(conf * 100)}%</b></div>` : ''}
      ${d.kind === 'match' && m ? confirmRow(d.key) : ''}
      <div class="row meta"><span class="prox ${d.band}">${d.band}</span><span>RSSI ${d.rssi}</span><span class="loc">📍 ~${bandRadius(d.band)} m${map.anchors.get(d.key) ? ' · pinned' : ''}</span>${m?.corroborated ? '<span class="tag">2 signals agree</span>' : ''}${m ? `<span class="muted">${m.signature.status}</span>` : ''}<span class="sid">#${esc(d.key.slice(0, 6))}</span></div>
    </li>`;
  }).join('');
}

/** Compact field-feedback row: stored locally (coarse cell, session hash), exported in the debug file, never uploaded. */
function confirmRow(key: string) {
  const v = recorder.confirmedAs(key);
  return `<div class="row confirm" data-key="${esc(key)}"><button type="button" class="yes${v === 'police' ? ' on' : ''}" data-v="police" aria-pressed="${v === 'police'}">✓ Saw police</button><button type="button" class="no${v === 'not-police' ? ' on' : ''}" data-v="not-police" aria-pressed="${v === 'not-police'}">✗ Not police</button>${v ? '<small>saved</small>' : ''}</div>`;
}
const maxRssi = (xs: (number | undefined)[]) => { const v = xs.filter((x): x is number => typeof x === 'number'); return v.length ? Math.max(...v) : undefined; };
$('cards').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.confirm button'); if (!b) return;
  const key = b.parentElement!.dataset.key!; const verdict = b.dataset.v as 'police' | 'not-police';
  const veh = fusion.vehicles.list().find(x => x.id === key);
  if (veh) {
    recorder.confirm({ verdict, kind: 'vehicle', dev: veh.id, radio: veh.radios.length > 1 ? 'mixed' : veh.radios[0], rules: veh.members.map(x => x.ruleId), tier: gradeOf(veh.confidence) as 'hint', confidence: veh.confidence, rssi: maxRssi(veh.members.map(x => x.samples[x.samples.length - 1]?.rssi)) }, pos);
  } else {
    const m = matches.get(key); if (!m) return; const d = live.list().find(x => x.key === key);
    recorder.confirm({ verdict, kind: 'device', dev: key, radio: m.radio ?? 'ble', rules: m.tierRule ? [m.signature.id, m.tierRule] : [m.signature.id], tier: gradeOf(m.confidence) as 'hint', confidence: m.confidence, rssi: d?.rssi ?? m.rssi }, pos);
  }
  toast(verdict === 'police' ? 'Noted: police confirmed. Saved to this session\'s debug file only.' : 'Noted: not police. Saved to this session\'s debug file only.');
  renderCards();
});

function vehicleCard(v: Vehicle) {
  const stale = Date.now() - v.lastSeen > 30_000; const pct = Math.round(v.confidence * 100);
  const rows = v.members.map(m => `<span class="vm ${m.radio}">${m.radio === 'wifi' ? '📶 Wi-Fi' : 'ᛒ BLE'} · ${esc(matches.get(m.key)?.signature.label ?? m.ruleId)} · ${Math.round(m.confidence * 100)}%</span>`).join('');
  return `<li class="card vehicle${stale ? ' stale' : ''}" style="--c:#ff1744">
    <div class="row"><span class="badge veh">🚓 Vehicle</span><span class="name">Possible patrol vehicle · ${v.members.length} signals</span><span class="ago">${ago(v.lastSeen)}</span></div>
    <div class="conf"><span class="grade">${gradeOf(v.confidence)}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>
    <div class="vmembers">${rows}</div>
    ${confirmRow(v.id)}
    <div class="row meta"><span>${v.radios.map(r => (r === 'wifi' ? 'Wi-Fi' : 'BLE')).join(' + ')}</span>${v.rssiCorrelated ? '<span class="tag">signals move together</span>' : ''}<span class="muted">${corroborationText(v)}</span></div>
  </li>`;
}
const announced = new Set<string>();
function onVehicle(v: Vehicle | undefined) {
  if (!v) return; recorder.vehicle(v);
  if (announced.has(v.id)) return; announced.add(v.id);
  logLine(`${new Date().toLocaleTimeString()} · 🚓 Vehicle: ${v.members.length} signals grouped (${v.radios.join(' + ')}) · ${Math.round(v.confidence * 100)}%`, '#ff1744');
  status(`🚓 Possible patrol vehicle: ${v.members.length} signals grouped (${Math.round(v.confidence * 100)}%)`, 'ok');
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
    scanner.onHealth = h => { recorder.setNativeHealth(h); setScanQuiet(h.quiet); };
    scanner.onSupervisor = (k, detail) => {
      if (k === 'quiet') { recorder.event('scanner-quiet', kind, detail); setScanQuiet(true); }
      else if (k === 'recovered') { recorder.event('scanner-recovered', kind); setScanQuiet(false); }
      else if (k === 'screen-on' || k === 'screen-off') recorder.event(k, kind);
      else if (k === 'restart' && !detail.startsWith('periodic')) recorder.event('auto-restart', kind, `native ${detail}`);
      else if (k === 'restart-failed') recorder.event('error', kind, `native restart failed: ${detail}`);
    };
  }
  if (scanner instanceof _NS) scanner.onWifi = nm => onWifi(nm);
  try {
    let advCb: (adv: any) => void;
    await scanner.start(advCb = adv => {
      supervisor.advert();
      const m0 = match(adv); const fz = m0 ? fusion.ble(m0, pos) : null; const m = m0 && ScanFusion.boostFlock(m0, fz); if (fz) patrolFlag(fz, pos); recorder.add(adv, m, pos); stats.record(!!m); allDevs.add(adv.sessionId); if (m) { policeDevs.add(adv.sessionId); matches.set(adv.sessionId, { ...m, radio: 'ble' }); onVehicle(fusion.vehicle({ ...m, radio: 'ble' }, pos)); }
      const isNew = !live.has(adv.sessionId);
      if (m) map.loc.observe(adv.sessionId, adv.timestamp, adv.rssi, 'ble', adv.txPower); // display-only closest-approach pin
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
let quietDismissed = false;
function setScanQuiet(on: boolean) { $('scan-quiet').hidden = !on || quietDismissed; if (!on) quietDismissed = false; }
$('sq-dismiss').onclick = () => { quietDismissed = true; $('scan-quiet').hidden = true; };
$('sq-restart').onclick = () => { $('scan-quiet').hidden = true; quietDismissed = false; if (scanner) { recorder.event('restart', sel.value, 'user restart from scanner-quiet warning'); stop(); } void start(); };
(globalThis as any).__prQuiet = setScanQuiet; // preview/debug hook
function stop() { setScanQuiet(false); supervisor.stopped(); fusion.clear(); announced.clear(); $('add').hidden = true; live.clear(); map.clearLive(); matches.clear(); if (scanner) recorder.event('stop', sel.value); scanner?.stop(); scanner = undefined; drawLive(); setScanning(false); status('Stopped'); }
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
// (fusion is declared near the top: the live-map draw reads its vehicle groups)
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
  const w = fusion.scoreWifi(nm, pos); if (!w) return;
  recorder.addWifi(w, nm.rssi, pos, Date.now(), bandOfMHz(nm.freq));
  const m = wifiAsMatch(w, nm); const f = fusion.wifi(w, pos); if (f) patrolFlag(f, pos);
  matches.set(m.sessionId, m); onVehicle(fusion.vehicle(m, pos));
  map.loc.observe(m.sessionId, nm.t ?? Date.now(), m.rssi, 'wifi');
  live.update(m.sessionId, m.rssi, m); drawLiveSoon();
  if (Date.now() - (lastSeen.get(m.sessionId) ?? 0) < 30_000) return; lastSeen.set(m.sessionId, Date.now());
  store.add({ id: crypto.randomUUID(), category: m.signature.category, label: m.signature.label, confidence: m.confidence, ...pos, timestamp: m.timestamp, radio: 'wifi' });
  map.render(store.list());
  addLog(`${new Date(m.timestamp).toLocaleTimeString()} · 📶 Wi-Fi · ${m.signature.label} · ${(m.confidence * 100).toFixed(0)}%${m.tierRule ? ` (${m.tierRule})` : ''} · RSSI ${m.rssi ?? '?'} (unverified)`, WIFI_COLOR);
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
// Traffic enforcement cameras (OSM + city open data), lazy 5° tiles, with their own Settings page and on-device alerts.
const TC_URL = `${import.meta.env.BASE_URL}data/traffic-cams/`;
const tcSet = loadTcSettings(), tcAlerter = new TrafficAlerter();
{ const ck = (id: string) => document.getElementById(id) as HTMLInputElement;
  const sel = (id: string) => document.getElementById(id) as HTMLSelectElement;
  const st = document.getElementById('tc-status'), sum = document.getElementById('tc-summary');
  const page = $('tc-settings');
  const openTc = (o: boolean) => { page.classList.toggle('open', o); page.setAttribute('aria-hidden', String(!o)); };
  $('open-tc').onclick = () => openTc(true); $('back-tc').onclick = () => openTc(false);
  $('close-settings').addEventListener('click', () => openTc(false)); $('scrim').addEventListener('click', () => openTc(false));
  const apply = () => {
    saveTcSettings(tcSet);
    map.setTrafficCamTypes(new Set(TC_TYPES.filter(t => tcSet.types[t])));
    for (const t of TC_TYPES) { const a = ck(`tc-alert-${t}`); a.disabled = !tcSet.types[t] || !tcSet.show; }
    $('tc-alerts').classList.toggle('off', !tcSet.alerts); $('tc-types').classList.toggle('off', !tcSet.show);
    const n = TC_TYPES.filter(t => alertsFor(tcSet, t)).length;
    if (sum) sum.textContent = !tcSet.show ? 'Hidden · no alerts' : `Shown · ${tcSet.alerts ? `alerts on (${n} type${n === 1 ? '' : 's'})` : 'alerts off'}`;
  };
  const show = (on: boolean) => map.showTrafficCams(on, TC_URL).then(() => { const i = map.trafficCamInfo; if (st && i) st.textContent = `${i.count.toLocaleString()} US traffic cameras · built ${i.generated.slice(0, 10)} · OSM as of ${i.sources.find(s => s.id === 'osm')?.last_updated ?? '?'} · zoom in to see them`; })
    .catch(e => { if (st) st.textContent = `Traffic camera layer unavailable (${(e as Error).message})`; });
  const m = ck('trafficcams'); m.checked = tcSet.show; m.onchange = () => { tcSet.show = m.checked; apply(); void show(m.checked); };
  for (const t of TC_TYPES) {
    const v = ck(`tc-show-${t}`); v.checked = tcSet.types[t]; v.onchange = () => { tcSet.types[t] = v.checked; apply(); };
    const a = ck(`tc-alert-${t}`); a.checked = tcSet.alertTypes[t]; a.onchange = () => { tcSet.alertTypes[t] = a.checked; apply(); };
  }
  const on = sel('tc-alerts-on'); on.value = tcSet.alerts ? 'on' : 'off'; on.onchange = () => { tcSet.alerts = on.value === 'on'; apply(); if (tcSet.alerts && tcSet.style === 'sound') void ping.unlock(); };
  const dist = sel('tc-distance'); dist.value = String(tcSet.distance); dist.onchange = () => { tcSet.distance = dist.value === 'auto' ? 'auto' : (+dist.value as AlertDistance); apply(); };
  const ah = ck('tc-ahead'); ah.checked = tcSet.aheadOnly; ah.onchange = () => { tcSet.aheadOnly = ah.checked; apply(); };
  const sty = sel('tc-style'); sty.value = tcSet.style; sty.onchange = () => { tcSet.style = sty.value as AlertStyle; apply(); if (tcSet.style === 'sound') void ping.unlock().then(() => ping.play('soft')); else if (tcSet.style === 'vibrate') navigator.vibrate?.(120); };
  apply(); if (tcSet.show) void show(true);
}
// Historical Stop History preview and Pro presentation. Purchases must not be enabled without verified Play Billing.
const HEAT_URL = `${import.meta.env.BASE_URL}data/stop-heat/`;
const HEAT_FILTER_KEY = 'pr.stopheat.filter';
const PRO_MONTHLY_USD = 1.99;
// Fail closed: never infer a paid entitlement from localStorage, URL parameters, or the UI.
const hasVerifiedPro = false; // TODO: replace with verified, server-backed Google Play entitlement.
{ const ck = (id: string) => document.getElementById(id) as HTMLInputElement;
  const sel = (id: string) => document.getElementById(id) as HTMLSelectElement;
  const page = $('heat-settings'), st = document.getElementById('heat-status'), sum = document.getElementById('heat-summary');
  const openHeat = (o: boolean) => { page.classList.toggle('open', o); page.setAttribute('aria-hidden', String(!o)); };
  map.setStopHeatPreview(!hasVerifiedPro);
  $('heat-upgrade').onclick = () => toast(`Patrol Radar Pro: ${PRO_MONTHLY_USD.toFixed(2)}/month planned. Purchases are not live yet.`);
  for (const id of ['heat-year-set', 'heat-tod-set', 'heat-dow-set']) {
    const field = $(id) as HTMLSelectElement; field.disabled = !hasVerifiedPro;
    field.setAttribute('aria-label', field.getAttribute('aria-label') + (!hasVerifiedPro ? ' (Pro subscription required)' : ''));
  }
  const offer = document.getElementById('heat-pro-offer');
  if (offer) offer.hidden = hasVerifiedPro;
  $('open-heat').onclick = () => openHeat(true); $('back-heat').onclick = () => openHeat(false);
  $('close-settings').addEventListener('click', () => openHeat(false)); $('scrim').addEventListener('click', () => openHeat(false));
  let saved: HeatFilter = { year: null, tod: null, dow: null };
  try { const v = JSON.parse(localStorage.getItem(HEAT_FILTER_KEY) ?? ''); if (v && typeof v === 'object') saved = { year: v.year ?? null, tod: v.tod ?? null, dow: v.dow ?? null }; } catch { /* default all */ }
  const read = (el: HTMLSelectElement, kind: 'year' | 'tod' | 'dow') => el.value === '' ? null : kind === 'year' ? +el.value : +el.value;
  const writeSel = (el: HTMLSelectElement, v: number | null) => { el.value = v == null ? '' : String(v); };
  const fill = (idx: StopHeatIndex) => {
    const yearOpts = '<option value="">All years</option>' + idx.years.map(y => `<option value="${y}">${y}</option>`).join('');
    const todOpts = '<option value="">All hours</option>' + idx.tod.map((t, i) => `<option value="${i}">${t.label} (${t.hint})</option>`).join('');
    const dowOpts = '<option value="">All days</option>' + idx.dow.map((d, i) => `<option value="${i}">${d}</option>`).join('');
    sel('heat-year-set').innerHTML = yearOpts;
    sel('heat-tod-set').innerHTML = todOpts;
    sel('heat-dow-set').innerHTML = dowOpts;
    sync();
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const src = document.getElementById('heat-sources');
    if (src) src.innerHTML = idx.sources.map(s => `<div><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><small>${s.stops.toLocaleString()} rows · ${s.mapped.toLocaleString()} mapped · ${esc(s.license)}${s.last_updated ? ` · updated ${esc(s.last_updated)}` : ''}</small></div>`).join('') || '<small>No source loaded.</small>';
    const gaps = document.getElementById('heat-gaps');
    if (gaps) gaps.innerHTML = (idx.notMapped ?? []).map(g => `<div><a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.name)}</a><small>${esc(g.why)}</small></div>`).join('');
    const ramp = [1, 10, 100, 1000];
    document.querySelectorAll<HTMLElement>('.heat-ramp i').forEach((el, i) => { el.style.background = heatPaint(ramp[i] ?? 1).css; });
  };
  const sync = () => {
    writeSel(sel('heat-year-set'), saved.year);
    writeSel(sel('heat-tod-set'), saved.tod);
    writeSel(sel('heat-dow-set'), saved.dow);
  };
  const applyFilter = () => {
    try { localStorage.setItem(HEAT_FILTER_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
    sync(); map.setStopHeatFilter(hasVerifiedPro ? saved : { year: null, tod: null, dow: null });
    if (sum) sum.textContent = !ck('stopheat').checked ? 'Hidden' : !hasVerifiedPro ? 'Free preview · Pro filters locked' : saved.year || saved.tod != null || saved.dow != null ? 'Shown · filtered' : 'Shown · all periods';
  };
  const onSel = (id: string, kind: 'year' | 'tod' | 'dow') => { sel(id).onchange = () => { if (!hasVerifiedPro) return; saved = { ...saved, [kind]: read(sel(id), kind) }; applyFilter(); }; };
  onSel('heat-year-set', 'year');
  onSel('heat-tod-set', 'tod');
  onSel('heat-dow-set', 'dow');
  const show = (on: boolean) => {
    map.showStopHeat(on, HEAT_URL).then(() => { const i = map.stopHeatInfo; if (i) { fill(i); if (st) st.textContent = `${i.totals.mapped.toLocaleString()} stops mapped · ${i.totals.beats.toLocaleString()} beats · ${i.totals.cells.toLocaleString()} grid cells · built ${i.generated.slice(0, 10)}`; } applyFilter(); })
      .catch(e => { if (st) st.textContent = `Stop history unavailable (${(e as Error).message})`; });
  };
  const m = ck('stopheat'); m.checked = localStorage.getItem('pr.stopheat') !== '0';
  m.onchange = () => { localStorage.setItem('pr.stopheat', m.checked ? '1' : '0'); applyFilter(); void show(m.checked); };
  applyFilter(); if (m.checked) void show(true);
}
let tcBannerT: number | undefined, tcBusy = false;
function showTcBanner(a: TcAlert) {
  const b = $('tc-banner'), meta = TC_META[a.cam.type];
  b.innerHTML = `${tcIcon(a.cam.type)}<span>${meta.label.replace(/^Automated speed camera$/, 'Speed camera')} ahead <small>· ${roundDist(a.distM)}</small></span>`;
  b.hidden = false; clearTimeout(tcBannerT); tcBannerT = window.setTimeout(() => { b.hidden = true; }, 8000);
  if (tcSet.style === 'sound') { ping.play('normal'); navigator.vibrate?.([200, 100, 200]); } else if (tcSet.style === 'vibrate') navigator.vibrate?.([200, 100, 200]);
}
/** Called for every GPS fix. Position/heading stay in memory for this check only; nothing is stored or sent. */
async function checkTrafficCams(f: Fix) {
  if (tcBusy || !tcSet.alerts || !tcSet.show) { tcAlerter.heading(f); return; }
  tcBusy = true;
  try { const cams = await map.trafficCamsNear(TC_URL, f.lat, f.lng, 700); const a = tcAlerter.check(f, cams, tcSet, travel().mode); if (a) showTcBanner(a); }
  catch { /* data unavailable: no alert */ } finally { tcBusy = false; }
}
(window as any).__tcTest = (f: Fix) => checkTrafficCams(f); // for screenshots / field tests
import { mountCityChat } from './cityChat';
mountCityChat(() => (here ? pos : undefined)); // coarse cell only; `here` is just the has-a-fix flag
import { mountTutorial, shouldAutoShow } from './tutorial';
{ const tour = mountTutorial({ onStep: s => { if (s.id !== 'sheet') sheet.classList.add('collapsed'); } });
  $('replay-tour').onclick = () => { setSettings(false); tour.open(); };
  if (shouldAutoShow(localStorage, location.search) && !location.hash) setTimeout(tour.open, 600); }
