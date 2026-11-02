/**
 * Android-only Wi-Fi rules (WifiManager scan results, passive: never connects or probes).
 * SSIDs and BSSIDs are matched INSIDE the native service against these patterns; only the rule id,
 * RSSI and a per-session salted hash cross the bridge. Nothing here is stored except the rule id.
 * Sources: Axon Fleet 3 network hub docs (Cradlepoint router, "<unit>-5g" SSID), Cradlepoint default SSIDs,
 * RF Sentinel police-detector rule table. All unverified until field-validated.
 */
export type WifiRole = 'vehicle-camera' | 'vehicle-router' | 'fixed-camera' | 'body-camera';
export interface WifiRule {
  id: string; label: string; vendor: string;
  category: 'vehicle' | 'fixed' | 'body-camera';
  role: WifiRole;
  ssid?: RegExp;           // matched against the SSID
  ouis?: string[];         // BSSID OUI prefixes (upper-case "AA:BB:CC")
  baseConfidence: number;
  status: 'unverified';
  addedIn?: string; changedIn?: string; source?: string;
}
export const CRADLEPOINT_OUIS = ['00:30:44']; // IEEE MA-L 00-30-44 CradlePoint, Inc.
export const AXON_WIFI_OUIS = ['00:25:DF']; // IEEE MA-L 00-25-DF Axon Enterprise, Inc. (verified 2026-10-31)
// Verified against standards-oui.ieee.org/oui/oui.txt on 2026-11-02. All are generic in-vehicle / fleet / consumer
// networking vendors: hint-grade only (buses, utilities, ambulances, hot-spots all use them).
export const CRADLEPOINT_OUIS_ALL = ['00:30:44', '00:E0:1C']; // CradlePoint, Inc (both MA-L blocks)
export const SIERRA_OUIS = ['00:A0:D5', '00:16:C0', '50:13:9D', '84:DB:2F', '64:CE:6E', 'CC:93:4A', '28:A3:31']; // Sierra Wireless ULC + Semtech Corp (AirLink)
export const DIGI_OUIS = ['00:40:9D']; // "DigiBoard" = Digi International's MA-L block (TransPort / IX routers)
export const INSEEGO_OUIS = ['00:15:FF', '28:80:A2', '18:EE:86', 'E0:86:14', '78:0C:71']; // Inseego Wireless (MiFi, Skyus, FX)
const IEEE = 'IEEE MA-L registry (standards-oui.ieee.org/oui/oui.txt, checked 2026-11-02)';
export const WIFI_RULES: WifiRule[] = [
  // BSSID OUI compared in memory inside WifiWatcher.java; BSSID/SSID never stored. Android scan results list access points
  // (beacons/probe responses), i.e. a body cam or Fleet hub in AP mode. Sources: AXEOFF (colonelpanichacks/axeoff, OUI on
  // Wi-Fi beacons + probes); all-cameras-are-beacons docs/signatures.md (Wi-Fi path conf 65, 8 field hits, owner-confirmed).
  { id: 'axon-oui-wifi', label: 'Axon Wi-Fi access point (BSSID OUI 00:25:DF)', vendor: 'Axon', category: 'body-camera', role: 'body-camera', ouis: AXON_WIFI_OUIS, baseConfidence: 0.6, status: 'unverified', addedIn: '1.0.18', source: 'IEEE MA-L 00-25-DF; github.com/colonelpanichacks/axeoff; github.com/soyboi1312/all-cameras-are-beacons' },
  { id: 'axon-fleet-ssid', label: 'Axon Fleet in-car Wi-Fi', vendor: 'Axon', category: 'vehicle', role: 'vehicle-camera', ssid: /^(Axon\d+|\d{3,5})-5g$/i, baseConfidence: 0.6, status: 'unverified' },
  { id: 'cradlepoint-ssid', label: 'Cradlepoint vehicle router', vendor: 'Cradlepoint', category: 'vehicle', role: 'vehicle-router', ssid: /^(IBR\d{3,4}|R1900|R2100|MBR1400)(-[0-9a-f]{3})?/i, baseConfidence: 0.3, status: 'unverified' },
  { id: 'cradlepoint-oui', label: 'Cradlepoint router (BSSID OUI)', vendor: 'Cradlepoint', category: 'vehicle', role: 'vehicle-router', ouis: CRADLEPOINT_OUIS_ALL, baseConfidence: 0.3, status: 'unverified', changedIn: '1.0.19', source: `${IEEE}: 00-30-44 + 00-E0-1C CradlePoint, Inc` },
  { id: 'sierra-oui', label: 'Sierra Wireless / Semtech AirLink router (BSSID OUI)', vendor: 'Sierra Wireless', category: 'vehicle', role: 'vehicle-router', ouis: SIERRA_OUIS, baseConfidence: 0.2, status: 'unverified', addedIn: '1.0.19', source: `${IEEE}: Sierra Wireless ULC (6 blocks), Semtech Corporation 00-16-C0` },
  { id: 'digi-oui', label: 'Digi router (BSSID OUI)', vendor: 'Digi International', category: 'vehicle', role: 'vehicle-router', ouis: DIGI_OUIS, baseConfidence: 0.15, status: 'unverified', addedIn: '1.0.19', source: `${IEEE}: 00-40-9D DigiBoard (Digi International)` },
  { id: 'inseego-oui', label: 'Inseego hotspot / router (BSSID OUI)', vendor: 'Inseego', category: 'vehicle', role: 'vehicle-router', ouis: INSEEGO_OUIS, baseConfidence: 0.15, status: 'unverified', addedIn: '1.0.19', source: `${IEEE}: Inseego Wireless, Inc (5 blocks)` },
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
