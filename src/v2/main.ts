import { mountMapSettings, savedMap3D } from '../settings/mapSettings';
import { findDestination, drivingRoutes, type PreviewRoute, type Coordinate, type Destination } from '../navigation/mapboxPreview';
import { NavigationPlaces, samePlace } from '../navigation/places';
import { routeRemaining, remainingSeconds, speedMph, arrivalTime, distanceToNextTurn } from '../navigation/tripDisplay';
import { Guidance } from '../navigation/guidance';
import './v2.css';
import { createScanner, match, pickDefaultBackend, isBluefy, classify, type Scanner, type BackendKind, type Match } from '../ble';
import { MapView, coarsen } from '../map';
import { LocalReportStore } from '../reports';
import { ScanStats } from '../ble/stats';
import { BluefyScanner } from '../ble/bluefyScanner';
import { NativeScanner, nativePlugin, type NativeScanMode } from '../ble/nativeScanner';
import { setupScannerPhrase, syncSetupScanner, webSetupMessage } from './setupCard';
import { LiveDeviceTracker, colorFor, WIFI_COLOR, bandRadius, type LiveDevice } from '../map/liveDevices';
import { corroborationText, type Vehicle } from '../fusion/vehicles';
import { bandOfMHz } from '../wifi/context';
import { WIFI_EVIDENCE_LINE, VEHICLE_EVIDENCE_LINE } from '../wifi/identity';
import { planWifi } from '../wifi/observe';
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

// A single map and BLE scanning session serve Patrol and Navigation.
// The destination picker is a separate full-screen view; a chosen route launches the driving HUD.
type MapExperience = 'patrol' | 'navigation';
const welcome = document.getElementById('mode-welcome')!;
const navigationPanel = document.getElementById('navigation-panel')!;
const changeMode = document.getElementById('change-mode') as HTMLButtonElement;
const navDestination = document.getElementById('navigation-destination') as HTMLInputElement;
const navSearchScreen = document.getElementById('navigation-search-screen')!;
const navSearchStatus = document.getElementById('navigation-search-status')!;
const navSearchResults = document.getElementById('navigation-search-results')!;
const previewStatus = document.getElementById('navigation-provider-status')!;
const previewResults = document.getElementById('navigation-results')!;
const routeButton = document.getElementById('navigation-search') as HTMLButtonElement;
const navSearchOpen = document.getElementById('navigation-open-search') as HTMLButtonElement;
const navSearchClose = document.getElementById('navigation-search-close') as HTMLButtonElement;
const navDriving = document.getElementById('navigation-driving')!;
const navDrivingStatus = document.getElementById('navigation-driving-status')!;
const navInstruction = document.getElementById('navigation-instruction')!;
const navDistance = document.getElementById('navigation-distance')!;
const navSpeed = document.getElementById('navigation-speed')!;
const navEta = document.getElementById('navigation-eta')!;
const navTimeLeft = document.getElementById('navigation-time-remaining')!;
const navTripDistance = document.getElementById('navigation-trip-distance')!;
const navStop = document.getElementById('navigation-stop') as HTMLButtonElement;
const mapboxPublicToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN?.trim() ?? '';
let navigationRequest: AbortController | undefined;
let activeGuidance: Guidance | undefined;
let activeDestination: Destination | undefined;
let currentRoute: PreviewRoute | undefined;
let lastRerouteAt = 0;
let tripGeneration = 0;
let nativeRemaining: {distance: number;seconds: number} | undefined;
const nativeNavigation = (globalThis as any).Capacitor?.isNativePlatform?.() ?
  ((globalThis as any).Capacitor?.Plugins?.MapboxNav ?? (globalThis as any).Capacitor?.registerPlugin?.('MapboxNav')) : undefined;
let nativeGuidanceActive = false;
let nativeManeuverAvailable = false;

function renderTripSummary(metresRemaining: number, secondsRemaining: number) {
  if(!Number.isFinite(metresRemaining) || !Number.isFinite(secondsRemaining))return;
  navEta.textContent=arrivalTime(secondsRemaining);
  navTimeLeft.textContent=Math.ceil(Math.max(0,secondsRemaining)/60)+' min remaining';
  navTripDistance.textContent=(Math.max(0,metresRemaining)/1609.344).toFixed(1)+' mi left';
}
if(nativeNavigation){
  void nativeNavigation.addListener('progress',(data:{distanceRemaining?:number;durationRemaining?:number;distanceToTurn?:number;instruction?:string})=>{
    if(!nativeGuidanceActive || !activeDestination)return;
    const distance=Number(data.distanceRemaining),seconds=Number(data.durationRemaining);
    if(Number.isFinite(distance) && distance>=0 && Number.isFinite(seconds) && seconds>=0){
      nativeRemaining={distance,seconds};
      renderTripSummary(distance,seconds);
    }
    if(typeof data.instruction==='string' && data.instruction.trim()){
      navInstruction.textContent=data.instruction;
      nativeManeuverAvailable=true;
    }
    if(Number.isFinite(data.distanceToTurn) && (data.distanceToTurn ?? -1)>=0)
      navDistance.textContent=distanceToNextTurn(data.distanceToTurn!)+' to next turn';
  });
  void nativeNavigation.addListener('route',(data:{geometry?:[number,number][]})=>{
    if(!nativeGuidanceActive || !Array.isArray(data.geometry) || data.geometry.length<2 || data.geometry.length>6000)return;
    if(data.geometry.every(p=>Array.isArray(p) && p.length===2 && p.every(n=>typeof n==='number' && Number.isFinite(n))))map.setNavigationRoute(data.geometry);
  });
  void nativeNavigation.addListener('voice',(data:{instruction?:string})=>{
    if(nativeGuidanceActive && data.instruction)navInstruction.textContent=data.instruction;
  });
}

function refreshPlaces() {
  const recents=NavigationPlaces.recents(),saved=NavigationPlaces.saved();
  const render=(id:string,places:Destination[],empty:string)=>{
    const host=document.getElementById(id)!;host.replaceChildren();
    if(!places.length){const p=document.createElement('p');p.className='navigation-list-empty';p.textContent=empty;host.append(p);return;}
    for(const place of places)host.append(placeRow(place));
  };
  const placeRow=(place:Destination):HTMLElement=>{
    const pinned=saved.some(p=>samePlace(p,place));
    const row=document.createElement('div');row.className='navigation-place-row'+(pinned?' is-saved':'');
    const main=document.createElement('button');main.type='button';main.className='navigation-place-main';
    const marker=document.createElement('span');marker.className='navigation-place-dot';marker.setAttribute('aria-hidden','true');
    const dot=document.createElement('span');dot.textContent='●';marker.append(dot);
    const label=document.createElement('span');label.textContent=place.label;main.append(marker,label);
    main.onclick=()=>void choosePlace(place);
    const save=document.createElement('button');save.type='button';save.className='navigation-save-place';save.textContent=pinned?'★':'☆';
    save.setAttribute('aria-label',(pinned?'Remove saved place: ':'Save place: ')+place.label);
    save.setAttribute('aria-pressed',String(pinned));
    save.onclick=()=>{NavigationPlaces.toggleSaved(place);refreshPlaces();};
    row.append(main,save);return row;
  };
  render('navigation-recent-list',recents,'No recent drives yet.');
  render('navigation-saved-list',saved,'Pin destinations here for quick access.');
  // Draw saved pins on the map, keeping coordinate storage on the device only.
  map.setNavigationPlaces(saved);
}
function openSearch() {
  if(document.body.dataset.experience!=='navigation' || activeGuidance)return;
  navSearchScreen.hidden=false;refreshPlaces();navDestination.focus();
}
function closeSearch() {
  navigationRequest?.abort();navigationRequest=undefined;
  routeButton.disabled=false;navSearchScreen.hidden=true;
  navSearchOpen.focus();
}
navSearchOpen.onclick=openSearch;
navSearchClose.onclick=closeSearch;
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && !navSearchScreen.hidden){event.preventDefault();closeSearch();}
});
(document.getElementById('navigation-clear-recents') as HTMLButtonElement).onclick=()=>{
  NavigationPlaces.clearRecents();refreshPlaces();
};

function chooseExperience(mode: MapExperience) {
  welcome.hidden=true;
  navigationPanel.hidden=mode!=='navigation' || !!activeGuidance;
  changeMode.hidden=mode==='navigation';
  document.body.dataset.experience=mode;
  if(nativeAppPresent() && !scanner)void start();
  if(mode==='navigation')refreshPlaces();else map.setNavigationPlaces([]);
  window.dispatchEvent(new Event('resize'));
}
(document.getElementById('choose-navigation') as HTMLButtonElement).onclick=()=>chooseExperience('navigation');
(document.getElementById('choose-patrol') as HTMLButtonElement).onclick=()=>chooseExperience('patrol');
function showModeChoices() {
  navigationRequest?.abort();
  if(!navSearchScreen.hidden)closeSearch();
  document.body.dataset.experience='';
  navigationPanel.hidden=true;welcome.hidden=false;changeMode.hidden=true;map.setNavigationPlaces([]);
}
changeMode.onclick=showModeChoices;
(document.getElementById('navigation-back') as HTMLButtonElement).onclick=showModeChoices;

function stopGuidance() {
  ++tripGeneration;
  if(nativeGuidanceActive && nativeNavigation)void nativeNavigation.stop().catch(()=>{});
  nativeGuidanceActive=false;nativeManeuverAvailable=false;nativeRemaining=undefined;
  activeGuidance=undefined;activeDestination=undefined;currentRoute=undefined;
  navDriving.hidden=true;document.body.dataset.navigationDriving='false';
  navigationPanel.hidden=document.body.dataset.experience!=='navigation';
  window.speechSynthesis?.cancel();
  map.setDrivingMode(false);map.setNavigationRoute([]);
}
navStop.onclick=()=>{stopGuidance();previewResults.replaceChildren();previewStatus.textContent='Trip ended. Search for another destination.';};
(document.getElementById('navigation-recenter') as HTMLButtonElement).onclick=()=>map.recenter();

async function startGuidance(route:PreviewRoute,destination:Destination){
  if(!route.steps.length){previewStatus.textContent='The route has no turn instructions.';return;}
  stopGuidance();
  const generation=tripGeneration;
  activeGuidance=new Guidance(route,destination);activeDestination=destination;currentRoute=route;
  NavigationPlaces.remember(destination);
  navDriving.hidden=false;document.body.dataset.navigationDriving='true';navigationPanel.hidden=true;
  navInstruction.textContent=route.steps[0].instruction;
  navDistance.textContent='Waiting for GPS…';
  navSpeed.textContent='—';renderTripSummary(route.distanceMeters,route.durationSeconds);
  navDrivingStatus.textContent='Guidance active while the app is open. Follow road signs.';
  navSearchScreen.hidden=true;
  map.setDrivingMode(true);map.setNavigationRoute(route.geometry,route.congestion);
  map.recenter();
  if(nativeNavigation && here){
    try {
      await nativeNavigation.start({originLat:here.lat,originLng:here.lng,destinationLat:destination.lat,destinationLng:destination.lng,
        preferredDistanceMeters:route.distanceMeters,preferredDurationSeconds:route.durationSeconds});
      if(generation===tripGeneration && activeDestination){
        nativeGuidanceActive=true;
        navDrivingStatus.textContent='Mapbox GPS guidance active';
      }else void nativeNavigation.stop().catch(()=>{});
    } catch {
      if(generation===tripGeneration)navDrivingStatus.textContent='Native guidance unavailable — on-screen GPS guidance active while the app is open.';
    }
  }
}
async function rerouteFrom(fix:Coordinate){
  if(!activeDestination || navigationRequest || nativeGuidanceActive)return;
  const dest={...activeDestination},request=new AbortController();
  navigationRequest=request;lastRerouteAt=Date.now();
  navDrivingStatus.textContent='Recalculating route…';
  try{
    const routes=await drivingRoutes(fix,dest,mapboxPublicToken,request.signal);
    if(routes.length && activeDestination && samePlace(activeDestination,dest)){
      activeGuidance=new Guidance(routes[0],dest);currentRoute=routes[0];
      map.setNavigationRoute(routes[0].geometry,routes[0].congestion);
      navDrivingStatus.textContent='Route updated';
    }
  }catch{
    if(!request.signal.aborted)navDrivingStatus.textContent='Rerouting unavailable. Follow road signs.';
  }finally{if(navigationRequest===request)navigationRequest=undefined;}
}
function updateActiveGuidance(fix:Coordinate,accuracy:number,speed?:number|null){
  if(!activeGuidance || !currentRoute || !activeDestination)return;
  if(!Number.isFinite(accuracy) || accuracy>80){navSpeed.textContent='—';navDrivingStatus.textContent='GPS signal weak. Guidance may be delayed.';return;}
  navSpeed.textContent=speedMph(speed);
  const progress=activeGuidance.update(fix,accuracy,Date.now());
  // Maneuver data comes from real Mapbox Directions steps; don't pretend this is lane guidance.
  if(!nativeGuidanceActive || !nativeManeuverAvailable)navInstruction.textContent=progress.instruction;
  if(!nativeGuidanceActive)navDistance.textContent=distanceToNextTurn(progress.metresToTurn)+' to next turn';
  const left=routeRemaining(currentRoute,fix);
  if(nativeGuidanceActive && nativeRemaining)renderTripSummary(nativeRemaining.distance,nativeRemaining.seconds);
  else renderTripSummary(left,remainingSeconds(currentRoute,left));
  if(!nativeGuidanceActive && progress.announce && 'speechSynthesis' in window){
    try{window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance(progress.announce));}
    catch{/* speech synthesis may be unavailable */}
  }
  if(progress.arrived){
    stopGuidance();previewStatus.textContent='You have arrived at your destination.';return;
  }
  if(!nativeGuidanceActive && progress.reroute && Date.now()-lastRerouteAt>60000)void rerouteFrom(fix);
}

function displaySearchResults(places:Destination[]){
  navSearchResults.replaceChildren();
  if(!places.length){navSearchStatus.textContent='No matching destinations. Try another place or a full street address.';return;}
  navSearchStatus.textContent='Nearby businesses first. Choose a destination to see routes.';
  const saved=NavigationPlaces.saved();
  for(const place of places){
    const row=document.createElement('div');row.className='navigation-place-row'+(saved.some(p=>samePlace(p,place))?' is-saved':'');
    const main=document.createElement('button');main.type='button';main.className='navigation-place-main';
    const pin=document.createElement('span');pin.className='navigation-place-dot';pin.setAttribute('aria-hidden','true');pin.textContent='●';
    const info=document.createElement('span');info.className='navigation-place-result-info';
    const title=document.createElement('span');title.className='navigation-place-result-label';title.textContent=place.name||place.label;info.append(title);
    const miles=Number.isFinite(place.distanceMeters) ? place.distanceMeters!/1609.344 : undefined;
    const approx=miles===undefined?'':(miles<0.1?'<0.1':miles<10?miles.toFixed(1):String(Math.round(miles)))+' mi straight-line';
    const detail=[approx,place.address].filter(Boolean).join(' · ');
    if(detail){const sub=document.createElement('small');sub.className='navigation-place-result-detail';sub.textContent=detail;info.append(sub);}
    main.append(pin,info);main.onclick=()=>void choosePlace(place);
    const star=document.createElement('button');star.type='button';star.className='navigation-save-place';
    star.textContent=saved.some(p=>samePlace(p,place))?'★':'☆';
    star.setAttribute('aria-label','Toggle saved place: '+place.label);
    star.setAttribute('aria-pressed',String(saved.some(p=>samePlace(p,place))));
    star.onclick=()=>{NavigationPlaces.toggleSaved(place);refreshPlaces();displaySearchResults(places);};
    row.append(main,star);navSearchResults.append(row);
  }
}
(document.getElementById('navigation-search-form') as HTMLFormElement).onsubmit=event=>{
  event.preventDefault();void searchDestinations();
};
async function searchDestinations(){
  if(!mapboxPublicToken.startsWith('pk.')){navSearchStatus.textContent='Mapbox public token is not configured.';return;}
  const query=navDestination.value.trim();
  if(!query || query.length>256){navSearchStatus.textContent='Enter an address or destination.';return;}
  if(!here){navSearchStatus.textContent='Waiting for your GPS location. Enable location to plan a drive.';return;}
  navigationRequest?.abort();
  const request=new AbortController();navigationRequest=request;routeButton.disabled=true;
  navSearchResults.replaceChildren();navSearchStatus.textContent='Searching destinations…';
  try{
    const places=await findDestination(query,mapboxPublicToken,{...here},request.signal);
    if(!request.signal.aborted)displaySearchResults(places);
  }catch(error){
    if(!request.signal.aborted)navSearchStatus.textContent=error instanceof Error?error.message:'Search unavailable.';
  }finally{if(navigationRequest===request){navigationRequest=undefined;routeButton.disabled=false;}}
}
async function choosePlace(place:Destination){
  if(!here){navSearchStatus.textContent='Your GPS location is needed to plan a route.';return;}
  if(!mapboxPublicToken.startsWith('pk.')){navSearchStatus.textContent='Mapbox is not configured.';return;}
  navigationRequest?.abort();const request=new AbortController();navigationRequest=request;
  navSearchStatus.textContent='Finding traffic-aware routes…';
  try{
    const routes=await drivingRoutes({...here},place,mapboxPublicToken,request.signal);
    if(!request.signal.aborted){
      renderRoutes(routes,place);
      navSearchScreen.hidden=true;
      navSearchOpen.focus();
    }
  }catch(error){
    if(!request.signal.aborted)navSearchStatus.textContent=error instanceof Error?error.message:'Could not calculate the drive.';
  }finally{if(navigationRequest===request)navigationRequest=undefined;}
}
function renderRoutes(routes:PreviewRoute[],destination:Destination){
  previewResults.replaceChildren();
  if(!routes.length){previewStatus.textContent='No drivable route found. Try a different destination.';return;}
  previewStatus.textContent='Choose a route to start driving.';
  for(const [index,route] of routes.entries()){
    const button=document.createElement('button');button.type='button';button.className='navigation-result';
    button.textContent=(index===0?'Recommended':'Alternative')+' · '+Math.round(route.durationSeconds/60)+' min · '+(route.distanceMeters/1609.344).toFixed(1)+' mi — '+destination.label;
    button.onclick=()=>void startGuidance(route,destination);
    previewResults.append(button);
  }
  map.setNavigationRoute(routes[0].geometry,routes[0].congestion);
}
const fusion = new ScanFusion();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const store = new LocalReportStore();
mountLegend($('map-legend'));
const map = new MapView($('map'), undefined, { dark: true, legend: false, layersControl: false, zoomControl: false, waitForLocation: true, initial3D: savedMap3D() });
map.onPresentationChange = state => {
  const loading = document.getElementById('map-startup');
  if (loading) { loading.hidden = state !== 'loading3d'; loading.textContent = 'Loading 3D map…'; }
  if (state === 'fallback') toast('3D map unavailable. Showing 2D instead.', true);
};
mountMapSettings(map);
void map.ready.then(() => { if (!map.wants3D) { const loading = document.getElementById('map-startup'); if (loading) loading.hidden = true; } });
let pos = { lat: 41.88, lng: -87.63 };
let scanner: Scanner | undefined;
let scanStartedAt = 0;
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
  if (!navigator.geolocation) { map.locationUnavailable(); $('geo').textContent = 'Location unavailable'; return; }
  if (geoWatch !== undefined) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = navigator.geolocation.watchPosition(p => {
    map.setUserLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.coords.speed, p.coords.heading, p.timestamp);
    here = { lat: p.coords.latitude, lng: p.coords.longitude }; drawLive();
    updateActiveGuidance(here, p.coords.accuracy, p.coords.speed);
    void checkTrafficCams({ lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed, heading: p.coords.heading, t: p.timestamp });
    recorder.fix(p.coords.accuracy, here);
    pos = coarsen(p.coords.latitude, p.coords.longitude);
    $('geo').textContent = `Location ±${Math.round(p.coords.accuracy)} m`;
  }, err => {
    map.locationUnavailable();
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
      ${wifi ? `<p class="evidence">${esc(WIFI_EVIDENCE_LINE)}</p>` : ''}
      <div class="row meta"><span class="prox ${d.band}">${d.band}</span><span>RSSI ${d.rssi}</span><span class="loc">📍 ~${bandRadius(d.band)} m${map.anchors.get(d.key) ? ' · pinned' : ''}</span>${m?.corroborated ? '<span class="tag">2 signals agree</span>' : ''}${m ? `<span class="muted">${m.signature.status}</span>` : ''}<span class="sid">${wifi ? (d.key.startsWith('wifi:') ? 'signature only' : `AP ${esc(d.key.slice(0, 6))}`) : `#${esc(d.key.slice(0, 6))}`}</span></div>
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
    <p class="evidence">${esc(VEHICLE_EVIDENCE_LINE)}</p>
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
  $('settings-scan-status').textContent = on ? 'Scanning active' : 'Scan is stopped';
  const b = $<HTMLButtonElement>('scan'); b.classList.toggle('on', on); $('scan-label').textContent = on ? 'Stop' : 'Scan'; b.setAttribute('aria-label', on ? 'Stop scan' : 'Start scan');
  syncSetupScanner(document, on);
}
async function start() {
  scanStartedAt = Date.now();
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
function stop() { setScanQuiet(false); supervisor.stopped(); fusion.clear(); announced.clear(); recorder.discardWifiSession(); $('add').hidden = true; live.clear(); map.clearLive(); matches.clear(); if (scanner) recorder.event('stop', sel.value); scanner?.stop(); scanner = undefined; drawLive(); setScanning(false); status('Stopped'); }
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
mountRecorder(recHost, recorder, () => sel.value, () => pos);
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
const vibration = $<HTMLInputElement>('ping-vibrate');
vibration.checked = localStorage.getItem('pr.pingVibrate') === 'on';
vibration.onchange = () => localStorage.setItem('pr.pingVibrate', vibration.checked ? 'on' : 'off');
if (!navigator.vibrate) $('vibrate-wrap').hidden = true;
$('sound-sample').onclick = () => { void ping.unlock().then(() => ping.play('normal')); };
const soundBox = $<HTMLInputElement>('sound'); soundBox.checked = soundEnabled();
soundBox.onchange = () => { setSoundEnabled(soundBox.checked); if (soundBox.checked) { void ping.unlock().then(() => ping.play('soft')); } };
function firePing(m: Match, loc: { lat: number; lng: number }) {
  const c = coarsen(loc.lat, loc.lng); const level = pingGate.check({ deviceKey: m.sessionId, cell: `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`, category: m.signature.category, matched: true });
  if (!level) return;
  toast(`🔔 Police gear nearby: ${m.signature.label} (${(m.confidence * 100).toFixed(0)}%)`);
  document.body.classList.add('pinging'); setTimeout(() => document.body.classList.remove('pinging'), 2500);
  if (!document.hidden && vibration.checked) navigator.vibrate?.(180);
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
function onWifi(raw: import('../ble/nativeScanner').NativeWifiMatch) {
  const plan = planWifi(raw); if (!plan) return;
  const w = fusion.scoreWifi(plan.context, pos); if (!w) return;
  const noted = recorder.noteWifi({ match: w, rssi: plan.match.rssi, loc: pos, scanAt: plan.scanAt, receivedAt: Date.now(), scanStartedAt, cached: plan.cached, apId: plan.apId, radioId: plan.radioId, band: bandOfMHz(plan.match.freq) });
  const m = wifiAsMatch(w, plan.match, noted.t); const f = fusion.wifi(w, pos); if (f) patrolFlag(f, pos);
  matches.set(m.sessionId, m); onVehicle(fusion.vehicle(m, pos));
  map.loc.observe(m.sessionId, noted.t, m.rssi, 'wifi');
  live.update(m.sessionId, m.rssi, m); drawLiveSoon();
  if (Date.now() - (lastSeen.get(m.sessionId) ?? 0) < 30_000) return; lastSeen.set(m.sessionId, Date.now());
  store.add({ id: crypto.randomUUID(), category: m.signature.category, label: m.signature.label, confidence: m.confidence, ...pos, timestamp: m.timestamp, radio: 'wifi' });
  map.render(store.list());
  const kind = noted.identity === 'ap' ? 'separate access point' : 'signature only; access points not distinguishable';
  addLog(`${new Date(m.timestamp).toLocaleTimeString()} · 📶 Wi-Fi · ${m.signature.label} · ${kind} · ${(m.confidence * 100).toFixed(0)}%${m.tierRule ? ` (${m.tierRule})` : ''} · RSSI ${m.rssi ?? '?'} · ${WIFI_EVIDENCE_LINE}`, WIFI_COLOR);
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

// Settings summaries reflect the controls rather than storing a second copy of their state.
function updateSettingsSummaries() {
  const mode = $<HTMLSelectElement>('scanmode');
  const modeLabel = ({ lowPower: 'Saver', balanced: 'Balanced', lowLatency: 'Fastest' } as Record<string, string>)[mode.value] ?? mode.value;
  $('settings-mode').textContent = isNativeApp ? `Scan mode: ${modeLabel}` : `Scanner: ${sel.options[sel.selectedIndex]?.text ?? sel.value}`;
  $('scanning-section-summary').textContent = `${isNativeApp ? modeLabel + ' · ' : ''}${picker.value === 'all' ? 'All devices' : 'Police gear'}`;
  $('alerts-section-summary').textContent = `Police ping ${soundBox.checked ? 'on' : 'off'} · camera alerts in Map layers`;
  $('crowd-section-summary').textContent = `Sharing ${shareBox.checked ? 'on' : 'off'} · crowd layer ${$<HTMLInputElement>('crowd').checked ? 'on' : 'off'}`;
  $('travel-section-summary').textContent = `${$<HTMLSelectElement>('travelmode').value === 'foot' ? 'On foot' : 'Car'} · 3D buildings ${$<HTMLInputElement>('map3d').checked ? 'on' : 'off'}`;
  $('layers-section-summary').textContent = `Flock cameras ${$<HTMLInputElement>('flockmap').checked ? 'on' : 'off'} · traffic cameras · Stop History`;
}
$('settings').addEventListener('change', updateSettingsSummaries);
updateSettingsSummaries();
const setupResults = $('setup-results');
async function checkSetup() {
  setupResults.hidden = false;
  setupResults.textContent = 'Checking your setup…';
  const pl = nativePlugin();
  if (!pl) {
    setupResults.textContent = webSetupMessage(!!scanner);
    return;
  }
  try {
    const r = await pl.setupStatus();
    const permission = (v: string) => v === 'granted' ? 'Allowed' : v === 'denied' ? 'Not allowed' : 'Not yet allowed';
    const lines = [
      ['Scanner', setupScannerPhrase(!!scanner, true)],
      ['Bluetooth', r.bluetooth === 'on' ? 'On' : r.bluetooth === 'off' ? 'Off — turn on Bluetooth' : 'Unable to check'],
      ['Nearby devices', permission(r.ble)],
      ['Location permission', permission(r.location)],
      ['Notifications', r.notificationsEnabled === false ? 'Off in Android settings' : permission(r.notifications)],
      ['Battery optimization', r.batteryExempt === true ? 'Unrestricted' : r.batteryExempt === false ? 'May limit background scanning' : 'Unable to check'],
    ];
    setupResults.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = 'Setup check'; setupResults.append(heading);
    for (const [label, value] of lines) { const row = document.createElement('div'); const name = document.createElement('span'); const state = document.createElement('b'); name.textContent = label; state.textContent = value; if (label === 'Scanner') state.id = 'setup-scanner-state'; row.append(name, state); setupResults.append(row); }
    const note = document.createElement('p'); note.textContent = 'Permissions can be changed in Android app settings. Starting a scan can request missing permissions. A setup check cannot guarantee a detection.'; setupResults.append(note);
    if (r.batteryExempt === false) { const button = document.createElement('button'); button.type = 'button'; button.className = 'row-btn'; button.textContent = 'Open battery settings'; button.onclick = () => { void pl.openBatterySettings(); }; setupResults.append(button); }
  } catch { setupResults.textContent = 'Setup information is unavailable on this version of the app. Check permissions and battery settings in Android settings.'; }
}
$('check-setup').onclick = () => { void checkSetup(); };
$('open-pro-settings').onclick = () => { $('open-heat').click(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && !setupResults.hidden) void checkSetup(); });
