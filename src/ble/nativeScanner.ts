import type { Scanner, AdvListener } from './types';
import { SIGNATURES, COMPANY_IDS } from './signatures';
import { normalizeEvent } from './normalize';
import { ScanError } from './errors';
import { nativeWifiRules } from '../wifi/rules';

export type NativeScanMode = 'lowPower' | 'balanced' | 'lowLatency';
/** Shape of one advert as sent by the Android PatrolScan plugin. `id` is already a salted hash (no MAC crosses the bridge). */
/** Wi-Fi match from the native WifiWatcher: rule ids only; SSID/BSSID never cross the bridge. */
export interface NativeWifiMatch { id: string; rssi?: number; rules: string[]; throttled?: number }
export interface NativeAdvert { id: string; name?: string; rssi?: number; txPower?: number; mfr?: Record<string, string>; uuids?: string[]; svc?: Record<string, string>; }

export function nativePlugin(): any | undefined {
  const cap = (globalThis as any).Capacitor;
  if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'android') return undefined;
  return cap.Plugins?.PatrolScan ?? cap.registerPlugin?.('PatrolScan');
}

/** Hardware scan filters built from the signature table. Needed so Android keeps scanning with the screen off. */
export function nativeFilters() {
  const serviceUuids = SIGNATURES.flatMap(s => s.rule.kind === 'serviceUuid16' ? [s.rule.uuid.toString(16).padStart(4, '0')] : []);
  return { companyIds: COMPANY_IDS, serviceUuids: [...new Set(serviceUuids)] };
}

/** Converts a native advert into the event shape normalizeEvent already understands. */
export function toEvent(a: NativeAdvert) {
  return { device: { id: a.id }, name: a.name, rssi: a.rssi, txPower: a.txPower, manufacturerData: a.mfr ?? {}, uuids: a.uuids ?? [], serviceData: a.svc ?? {} };
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
  private wifiHandle?: { remove(): Promise<void> | void };

  async isSupported() { return !!this.plugin; }
  async start(onAdv: AdvListener) {
    if (!this.plugin) throw new ScanError('unsupported', 'Native scanner only works inside the Patrol Radar Android app.');
    const perm = await this.plugin.requestScanPermissions();
    if (perm?.ble !== 'granted') throw new ScanError('permission', 'Allow "Nearby devices" for Patrol Radar in Android Settings > Apps > Patrol Radar > Permissions.');
    this.handle = await this.plugin.addListener('advert', (a: NativeAdvert) => { normalizeEvent(toEvent(a)).then(onAdv); });
    if (this.wifi) this.wifiHandle = await this.plugin.addListener('wifi', (m: NativeWifiMatch) => { if (Array.isArray(m?.rules)) this.onWifi?.({ id: String(m.id), rssi: m.rssi, rules: m.rules.map(String), throttled: m.throttled }); });
    this.stateHandle = await this.plugin.addListener('state', (s: { state: string; detail?: string }) => {
      if (s?.state === 'error') { const msg = s.detail || 'Native scan failed'; this.cleanup(); this.onError?.(msg); }
    });
    try { await this.plugin.start({ mode: this.mode, filtered: this.filtered, ...nativeFilters(), ...(this.wifi ? { wifiRules: nativeWifiRules() } : {}) }); }
    catch (e) { this.cleanup(); throw new ScanError('other', (e as any)?.message ?? String(e)); }
  }
  private cleanup() { this.handle?.remove(); this.handle = undefined; this.stateHandle?.remove(); this.stateHandle = undefined; this.wifiHandle?.remove(); this.wifiHandle = undefined; }
  stop() { this.plugin?.stop?.(); this.cleanup(); }
}
