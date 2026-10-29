/**
 * Android-only Wi-Fi rules (WifiManager scan results, passive: never connects or probes).
 * SSIDs and BSSIDs are matched INSIDE the native service against these patterns; only the rule id,
 * RSSI and a per-session salted hash cross the bridge. Nothing here is stored except the rule id.
 * Sources: Axon Fleet 3 network hub docs (Cradlepoint router, "<unit>-5g" SSID), Cradlepoint default SSIDs,
 * RF Sentinel police-detector rule table. All unverified until field-validated.
 */
export type WifiRole = 'vehicle-camera' | 'vehicle-router' | 'fixed-camera';
export interface WifiRule {
  id: string; label: string; vendor: string;
  category: 'vehicle' | 'fixed';
  role: WifiRole;
  ssid?: RegExp;           // matched against the SSID
  ouis?: string[];         // BSSID OUI prefixes (upper-case "AA:BB:CC")
  baseConfidence: number;
  status: 'unverified';
}
export const CRADLEPOINT_OUIS = ['00:30:44']; // IEEE MA-L 00-30-44 CradlePoint, Inc.
export const WIFI_RULES: WifiRule[] = [
  { id: 'axon-fleet-ssid', label: 'Axon Fleet in-car Wi-Fi', vendor: 'Axon', category: 'vehicle', role: 'vehicle-camera', ssid: /^(Axon\d+|\d{3,5})-5g$/i, baseConfidence: 0.6, status: 'unverified' },
  { id: 'cradlepoint-ssid', label: 'Cradlepoint vehicle router', vendor: 'Cradlepoint', category: 'vehicle', role: 'vehicle-router', ssid: /^(IBR\d{3,4}|R1900|R2100|MBR1400)(-[0-9a-f]{3})?/i, baseConfidence: 0.3, status: 'unverified' },
  { id: 'cradlepoint-oui', label: 'Cradlepoint router (BSSID OUI)', vendor: 'Cradlepoint', category: 'vehicle', role: 'vehicle-router', ouis: CRADLEPOINT_OUIS, baseConfidence: 0.3, status: 'unverified' },
  { id: 'flock-ssid', label: 'Flock camera Wi-Fi', vendor: 'Flock Safety', category: 'fixed', role: 'fixed-camera', ssid: /^Flock-/, baseConfidence: 0.7, status: 'unverified' },
];
export interface WifiMatch { rules: string[]; best: WifiRule; confidence: number; corroborated: boolean }
const oui = (bssid?: string) => (bssid ?? '').toUpperCase().replace(/-/g, ':').slice(0, 8);
/** Reference matcher (mirrors WifiWatcher.java). Returns only rule ids, never the SSID/BSSID. */
export function matchWifi(ssid: string | undefined, bssid?: string): WifiMatch | null {
  const hits = WIFI_RULES.filter(r => (r.ssid && !!ssid && r.ssid.test(ssid)) || (r.ouis && r.ouis.includes(oui(bssid))));
  return fuseWifi(hits.map(h => h.id));
}
export function fuseWifi(ids: string[]): WifiMatch | null {
  const hits = WIFI_RULES.filter(r => ids.includes(r.id)); if (!hits.length) return null;
  let conf = 1 - hits.reduce((p, r) => p * (1 - r.baseConfidence), 1);
  const corroborated = hits.length >= 2;
  const best = hits.reduce((a, b) => (b.baseConfidence > a.baseConfidence ? b : a));
  return { rules: hits.map(h => h.id), best, confidence: Math.min(0.99, +conf.toFixed(2)), corroborated };
}
/** Patterns handed to the native service (Java regex; JS /i -> flag "i"). */
export const nativeWifiRules = () => WIFI_RULES.map(r => ({ id: r.id, ssid: r.ssid?.source ?? '', flags: r.ssid?.flags.includes('i') ? 'i' : '', ouis: r.ouis ?? [] }));
