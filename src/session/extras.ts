import type { Match } from '../ble/matcher';
import type { Signature } from '../ble/signatures';
import { coarsen } from '../map/coarsen';
import { GearFusion, gearTypeFor, FLOCK_BOOST_CONF, type FusionResult } from '../fusion/gearFusion';
import { fuseWifi, WIFI_RULES, type WifiMatch } from '../wifi/rules';
import type { NativeWifiMatch } from '../ble/nativeScanner';

export const cellKey = (loc: { lat: number; lng: number }) => { const c = coarsen(loc.lat, loc.lng); return `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`; };

/** Wraps a Wi-Fi rule match as a Match so the existing map/log/cards/ping code can show it. */
export function wifiAsMatch(w: WifiMatch, nm: NativeWifiMatch, t = Date.now()): Match {
  const r = w.best;
  const signature: Signature = { id: r.id, label: `${r.label} (Wi-Fi)`, vendor: r.vendor, category: r.category, rule: { kind: 'namePattern', pattern: /(?!)/ }, baseConfidence: r.baseConfidence, status: r.status };
  return { signature, confidence: w.confidence, corroborated: w.corroborated, rssi: nm.rssi, timestamp: t, sessionId: nm.id };
}
export function toWifiMatch(nm: NativeWifiMatch): WifiMatch | null { return fuseWifi(nm.rules); }

/** Feeds BLE / Wi-Fi matches into the coarse-cell fusion. */
export class ScanFusion {
  readonly fusion = new GearFusion();
  ble(m: Match, loc: { lat: number; lng: number }, t = m.timestamp): FusionResult | null {
    const g = gearTypeFor(m.signature.category, m.signature.id); if (!g) return null;
    return this.fusion.add({ cell: cellKey(loc), t, gear: g, ruleId: m.signature.id });
  }
  wifi(w: WifiMatch, loc: { lat: number; lng: number }, t = Date.now()): FusionResult | null {
    let last: FusionResult | null = null;
    for (const id of w.rules) { const r = WIFI_RULES.find(x => x.id === id)!; const g = gearTypeFor(r.category, r.id, r.role); if (g) last = this.fusion.add({ cell: cellKey(loc), t, gear: g, ruleId: id }); }
    return last;
  }
  /** Applies the cross-radio Flock boost to a weak XUNTONG match. */
  static boostFlock(m: Match, f: FusionResult | null): Match { return f?.flockBoost && m.signature.id === 'flock-xuntong-cid' ? { ...m, confidence: Math.max(m.confidence, FLOCK_BOOST_CONF), corroborated: true } : m; }
}
