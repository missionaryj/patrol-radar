/**
 * Tiered Wi-Fi confidence (same structure as the Axon BLE rules: one vendor, several rules, each with its own weight).
 * A base rule (OUI or SSID pattern, see rules.ts) only names the VENDOR. Contextual rules below climb a tier only when
 * independent evidence agrees. Same-vendor base rules never multiply together (an OUI and a default SSID on the same
 * router are one piece of evidence about one box), so the result is the strongest applicable rule, not a product.
 *
 * Features (all computed in memory per session, never stored as identifiers):
 *  - ssid:      a vendor-typical SSID pattern matched natively (the SSID itself never leaves WifiWatcher.java)
 *  - dualBand:  the same radio (per-session salted hash of the BSSID's first 5 octets) seen on 2.4 GHz AND 5 GHz
 *  - persistent: the same access point (salted hash) seen in >= 3 separate scans over >= 60 s
 *  - blePolice: a police-gear BLE match (>= 0.5, not fixed infrastructure) in the same coarse cell within 30 s
 *  - bleAxon:   an Axon BLE match in the same coarse cell within 30 s
 * Docs and rationale: docs/signatures.md ("Wi-Fi tiers").
 */
import { WIFI_RULES, type WifiRule, type WifiMatch } from './rules';

export type WifiFeature = 'ssid' | 'oui' | 'dualBand' | 'persistent' | 'blePolice' | 'bleAxon';
export interface WifiContext { dualBand?: boolean; persistent?: boolean; blePolice?: boolean; bleAxon?: boolean }
export interface WifiTierRule {
  id: string; vendor: string; label: string;
  /** Every listed feature must be present. 'oui'/'ssid' mean a base OUI / SSID rule of this vendor fired. */
  needs: WifiFeature[];
  /** At least one of these features must also be present (optional). */
  anyOf?: WifiFeature[];
  confidence: number; addedIn: string; note: string;
}
const V = '1.0.19';
export const WIFI_TIERS: WifiTierRule[] = [
  // Axon: the OUI and the Fleet SSID are both Axon-specific, so two of them are real corroboration.
  { id: 'axon-wifi-oui-ssid', vendor: 'Axon', label: 'Axon Wi-Fi (OUI + Fleet SSID)', needs: ['oui', 'ssid'], confidence: 0.8, addedIn: V, note: 'Two Axon-only identifiers on one AP.' },
  { id: 'axon-wifi-persistent', vendor: 'Axon', label: 'Axon Wi-Fi (seen across scans)', needs: ['persistent'], anyOf: ['oui', 'ssid'], confidence: 0.65, addedIn: V, note: 'Small step: rules out a one-off ghost result.' },
  { id: 'axon-wifi-ble', vendor: 'Axon', label: 'Axon Wi-Fi + Axon Bluetooth nearby', needs: ['bleAxon'], anyOf: ['oui', 'ssid'], confidence: 0.88, addedIn: V, note: 'Two radios, same vendor, same cell and 30 s window.' },
  // Cradlepoint: generic fleet router (buses, ambulances, utilities, retail). Never strong on its own.
  { id: 'cradlepoint-oui-ssid', vendor: 'Cradlepoint', label: 'Cradlepoint router (OUI + default SSID)', needs: ['oui', 'ssid'], confidence: 0.4, addedIn: V, note: 'Confirms a Cradlepoint, not a police car.' },
  { id: 'cradlepoint-dualband', vendor: 'Cradlepoint', label: 'Cradlepoint router (2.4 + 5 GHz pair)', needs: ['oui', 'dualBand'], confidence: 0.35, addedIn: V, note: 'Mobile IBR/R-series routers broadcast both bands; so do fixed ones.' },
  { id: 'cradlepoint-persistent', vendor: 'Cradlepoint', label: 'Cradlepoint router (seen across scans)', needs: ['persistent'], anyOf: ['oui', 'ssid'], confidence: 0.4, addedIn: V, note: 'Not a one-off result.' },
  { id: 'cradlepoint-ble-police', vendor: 'Cradlepoint', label: 'Cradlepoint router + police Bluetooth nearby', needs: ['blePolice'], anyOf: ['oui', 'ssid'], confidence: 0.6, addedIn: V, note: 'Likely: in-car router next to police BLE gear.' },
  { id: 'cradlepoint-ble-police-multi', vendor: 'Cradlepoint', label: 'Cradlepoint router (OUI + SSID/dual-band + persistent) + police Bluetooth', needs: ['oui', 'blePolice', 'persistent'], anyOf: ['ssid', 'dualBand'], confidence: 0.75, addedIn: V, note: 'Ceiling for Cradlepoint; strong needs field validation.' },
  // Other in-vehicle router / hotspot vendors: hints unless police BLE is next to them.
  { id: 'sierra-ble-police', vendor: 'Sierra Wireless', label: 'Sierra / AirLink router + police Bluetooth nearby', needs: ['oui', 'blePolice'], confidence: 0.5, addedIn: V, note: 'AirLink MG90/MP70/XR are common in police fleets but also transit and utilities.' },
  { id: 'digi-ble-police', vendor: 'Digi International', label: 'Digi router + police Bluetooth nearby', needs: ['oui', 'blePolice'], confidence: 0.45, addedIn: V, note: 'Stays a hint: Digi is mostly industrial / transit.' },
  { id: 'inseego-ble-police', vendor: 'Inseego', label: 'Inseego hotspot + police Bluetooth nearby', needs: ['oui', 'blePolice'], confidence: 0.4, addedIn: V, note: 'Stays a hint: MiFi hotspots are consumer gear too.' },
];

export interface TieredWifiMatch extends WifiMatch { tierRule?: string; features: WifiFeature[] }

const featuresFor = (vendorHits: WifiRule[], ctx: WifiContext): Set<WifiFeature> => {
  const f = new Set<WifiFeature>();
  if (vendorHits.some(r => r.ouis?.length)) f.add('oui');
  if (vendorHits.some(r => r.ssid)) f.add('ssid');
  if (ctx.dualBand) f.add('dualBand'); if (ctx.persistent) f.add('persistent'); if (ctx.blePolice) f.add('blePolice'); if (ctx.bleAxon) { f.add('bleAxon'); f.add('blePolice'); }
  return f;
};
const applies = (t: WifiTierRule, f: Set<WifiFeature>) => t.needs.every(x => f.has(x)) && (!t.anyOf || t.anyOf.some(x => f.has(x)));

/**
 * Scores native rule ids with context. Per vendor: max(base rule weights, applicable tier rules). Across vendors the best
 * vendor wins (two vendors on one AP is a rule collision, not corroboration). Returns only rule ids and numbers.
 */
export function scoreWifi(ids: string[], ctx: WifiContext = {}): TieredWifiMatch | null {
  const hits = WIFI_RULES.filter(r => ids.includes(r.id)); if (!hits.length) return null;
  let best: { conf: number; rule: WifiRule; tier?: WifiTierRule; feats: Set<WifiFeature>; vendorHits: WifiRule[] } | undefined;
  for (const vendor of new Set(hits.map(h => h.vendor))) {
    const vh = hits.filter(h => h.vendor === vendor); const feats = featuresFor(vh, ctx);
    const top = vh.reduce((a, b) => (b.baseConfidence > a.baseConfidence ? b : a));
    let conf = top.baseConfidence, tier: WifiTierRule | undefined;
    for (const t of WIFI_TIERS) if (t.vendor === vendor && applies(t, feats) && t.confidence > conf) { conf = t.confidence; tier = t; }
    if (!best || conf > best.conf) best = { conf, rule: top, tier, feats, vendorHits: vh };
  }
  const b = best!;
  const used = b.tier ? [...b.tier.needs, ...(b.tier.anyOf ?? []).filter(x => b.feats.has(x))] : [];
  return { rules: hits.map(h => h.id), best: b.rule, confidence: Math.min(0.99, +b.conf.toFixed(2)), corroborated: !!b.tier, tierRule: b.tier?.id, features: [...new Set(used)] };
}
export const gradeOf = (c: number) => (c >= 0.85 ? 'strong' : c >= 0.5 ? 'likely' : 'hint');
