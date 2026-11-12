import type { Scanner, AdvListener } from './types';
import { SIGNATURES, COMPANY_IDS, OUIS } from './signatures';
import { normalizeEvent } from './normalize';
import { ScanError } from './errors';
import { nativeWifiRules } from '../wifi/rules';

export type NativeScanMode = 'lowPower' | 'balanced' | 'lowLatency';
/** Shape of one advert as sent by the Android PatrolScan plugin. `id` is already a salted hash (no MAC crosses the bridge). */
/** Wi-Fi match from the native WifiWatcher: rule ids only; SSID/BSSID never cross the bridge. */
/** id = salted hash of the AP; radio = salted hash of the BSSID's first 5 octets (pairs 2.4/5 GHz BSSIDs of one box); freq in MHz.
 *  cached = the OS result predates this scan watcher (a buffered scan, not a live observation). */
export interface NativeWifiMatch { id: string; rssi?: number; rules: string[]; throttled?: number; radio?: string; freq?: number; t?: number; cached?: boolean }
export interface NativeAdvert { id: string; name?: string; rssi?: number; txPower?: number; mfr?: Record<string, string>; uuids?: string[]; svc?: Record<string, string>; oui?: string; t?: number }

export interface NativeDiagnostics {
  nativeCallbacks?: number; nativeCallbacksPerMin?: number; lastCallbackAgeMs?: number | null;
  scanState?: 'stopped' | 'starting' | 'receiving' | 'failed';
  lastRestartReason?: 'none' | 'stall' | 'periodic' | 'screen' | 'failure';
  lastRestartResult?: 'none' | 'pending' | 'failed' | 'recovered';
  scanFailureCode?: number; requestedFiltered?: boolean; filteredNow?: boolean;
}
/** Explicit allowlist also used at the export boundary; arbitrary native fields never persist. */
export function nativeDiagnostics(o: NativeDiagnostics): NativeDiagnostics {
  const out: NativeDiagnostics = {};
  for (const k of ['nativeCallbacks', 'nativeCallbacksPerMin', 'lastCallbackAgeMs', 'scanFailureCode'] as const) {
    const v = o[k]; if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  if (o.lastCallbackAgeMs === null) out.lastCallbackAgeMs = null;
  if (typeof o.requestedFiltered === 'boolean') out.requestedFiltered = o.requestedFiltered;
  if (typeof o.filteredNow === 'boolean') out.filteredNow = o.filteredNow;
  if (['stopped', 'starting', 'receiving', 'failed'].includes(o.scanState!)) out.scanState = o.scanState;
  if (['none', 'stall', 'periodic', 'screen', 'failure'].includes(o.lastRestartReason!)) out.lastRestartReason = o.lastRestartReason;
  if (['none', 'pending', 'failed', 'recovered'].includes(o.lastRestartResult!)) out.lastRestartResult = o.lastRestartResult;
  return out;
}
export interface NativeScanHealth extends NativeDiagnostics {
  scanRestarts: { stall: number; periodic: number; screen: number; failed: number };
  screenOffSec: number; screenOn: boolean; filteredNow: boolean; quiet: boolean; baselinePerMin: number;
  android: { sdk: number; release: string; deviceClass: string };
}
/** Parses the native 'health' state detail; drops anything outside the known count fields. */
export function parseNativeHealth(detail?: string): NativeScanHealth | null {
  try {
    const o = JSON.parse(detail ?? ''); const n = (x: unknown) => (typeof x === 'number' && isFinite(x) ? x : 0); const r = o.scanRestarts ?? {};
    return {
      ...nativeDiagnostics(o),
      scanRestarts: { stall: n(r.stall), periodic: n(r.periodic), screen: n(r.screen), failed: n(r.failed) },
      screenOffSec: n(o.screenOffSec), screenOn: !!o.screenOn, filteredNow: !!o.filteredNow, quiet: !!o.quiet, baselinePerMin: n(o.baselinePerMin),
      android: { sdk: n(o.android?.sdk), release: String(o.android?.release ?? '').slice(0, 8), deviceClass: String(o.android?.deviceClass ?? '').slice(0, 24) },
    };
  } catch { return null; }
}

export function nativePlugin(): any | undefined {
  const cap = (globalThis as any).Capacitor;
  if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'android') return undefined;
  return cap.Plugins?.PatrolScan ?? cap.registerPlugin?.('PatrolScan');
}

/** Hardware scan filters built from the signature table. Needed so Android keeps scanning with the screen off. */
export function nativeFilters() {
  const serviceUuids = SIGNATURES.flatMap(s => s.rule.kind === 'serviceUuid16' || s.rule.kind === 'serviceData16' ? [s.rule.uuid.toString(16).padStart(4, '0')] : []);
  return { companyIds: COMPANY_IDS, serviceUuids: [...new Set(serviceUuids)], ouis: OUIS };
}

// Serialize native commands across scanner instances: Stop must follow any pending Start.
let nativeCommands: Promise<void> = Promise.resolve();
function nativeCommand<T>(action: () => Promise<T> | T): Promise<T> {
  const next = nativeCommands.then(action);
  nativeCommands = next.then(() => {}, () => {});
  return next;
}

/** Converts a native advert into the event shape normalizeEvent already understands. */
export function toEvent(a: NativeAdvert) {
  return { device: { id: a.id }, name: a.name, rssi: a.rssi, txPower: a.txPower, manufacturerData: a.mfr ?? {}, uuids: a.uuids ?? [], serviceData: a.svc ?? {}, oui: a.oui, t: a.t };
}

/**
 * Android app backend (Capacitor). PASSIVE ONLY: the native side runs BluetoothLeScanner.startScan
 * in a foreground service; it never connects, pairs, bonds or writes. Adverts are forwarded to the
 * same matcher / recorder / map as the web backends. Nothing is uploaded.
 */
export class NativeScanner implements Scanner {
  readonly name = 'android-native';
  mode: NativeScanMode = 'balanced';
  /** true = hardware filters for police signatures only (works with screen off). false = all devices (screen on only on most phones). */
  filtered = true;
  private plugin = nativePlugin();
  private handle?: { remove(): Promise<void> | void };
  private stateHandle?: { remove(): Promise<void> | void };
  /** Called when the native service reports a failure after start (Bluetooth off, scan failed, service stopped by OS). */
  onError?: (message: string) => void;
  /** Android-only Wi-Fi rule matches (see src/wifi/rules.ts). */
  onWifi?: (m: NativeWifiMatch) => void;
  /** Enable passive Wi-Fi rule matching alongside BLE. */
  wifi = true;
  /** Native scan supervisor reports (1.0.23): counts + Android version class only. */
  onHealth?: (h: NativeScanHealth) => void;
  /** kind: 'restart' (detail = reason), 'quiet' (scanner silent and restarts did not help), 'recovered', 'screen-on' / 'screen-off'. */
  onSupervisor?: (kind: string, detail: string) => void;
  private wifiHandle?: { remove(): Promise<void> | void };
  private generation = 0;
  private stopped = false;

  async isSupported() { return !!this.plugin; }
  /** An active native session may temporarily be running=false while bounded retries occur. */
  async serviceStatus(): Promise<{ sessionActive: boolean; running: boolean } | undefined> {
    return this.plugin?.status?.();
  }
  async start(onAdv: AdvListener) {
    if (!this.plugin) throw new ScanError('unsupported', 'Native scanner only works inside the Patrol Radar Android app.');
    this.stopped = false;
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    const listen = async (name: string, cb: (event: any) => void) => {
      const handle = await this.plugin.addListener(name, cb);
      if (!current()) { void handle.remove(); return undefined; }
      return handle as { remove(): Promise<void> | void };
    };
    const perm = await this.plugin.requestScanPermissions();
    if (!current()) return; // Cancel when Stop/Change Mode was tapped during permissions.
    if (perm?.ble !== 'granted') throw new ScanError('permission', 'Allow "Nearby devices" for Patrol Radar in Android Settings > Apps > Patrol Radar > Permissions.');
    try {
      this.handle = await listen('advert', (a: NativeAdvert) => {
        void normalizeEvent(toEvent(a)).then(adv => { if (current()) onAdv(adv); }).catch(() => {});
      });
      if (!current()) return;
      if (this.wifi) {
        this.wifiHandle = await listen('wifi', (m: NativeWifiMatch) => {
          if (current() && Array.isArray(m?.rules)) this.onWifi?.({ id: String(m.id), rssi: m.rssi, rules: m.rules.map(String), throttled: m.throttled, radio: m.radio ? String(m.radio) : undefined, freq: typeof m.freq === 'number' ? m.freq : undefined, t: typeof m.t === 'number' ? m.t : undefined, cached: m.cached === true });
        });
        if (!current()) return;
      }
      this.stateHandle = await listen('state', (s: { state: string; detail?: string }) => {
        if (!current()) return;
        if (s?.state === 'health') { const h = parseNativeHealth(s.detail); if (h) this.onHealth?.(h); return; }
        if (s && ['restart', 'restart-failed', 'quiet', 'recovered', 'screen-on', 'screen-off'].includes(s.state)) { this.onSupervisor?.(s.state, s.detail ?? ''); return; }
        if (s?.state === 'error' || s?.state === 'stopped') {
          this.cleanup();
          this.onError?.(s.detail || (s.state === 'stopped' ? 'Android background scan stopped. Tap Scan to restart.' : 'Native scan failed'));
        }
      });
      if (!current()) return;
      await nativeCommand(() => current() ? this.plugin.start({ mode: this.mode, filtered: this.filtered, ...nativeFilters(), ...(this.wifi ? { wifiRules: nativeWifiRules() } : {}) }) : undefined);
    } catch (e) {
      if (!current()) return;
      this.cleanup();
      throw new ScanError('other', (e as any)?.message ?? String(e));
    }
  }
  private cleanup() { void this.handle?.remove(); this.handle = undefined; void this.stateHandle?.remove(); this.stateHandle = undefined; void this.wifiHandle?.remove(); this.wifiHandle = undefined; }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    ++this.generation;
    this.cleanup();
    // Run Stop after an in-flight native Start, even when Start resolves late.
    void nativeCommand(() => this.plugin?.stop?.()).catch(() => {});
  }
}
