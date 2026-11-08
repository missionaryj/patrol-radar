import type { NativeWifiMatch } from '../ble/nativeScanner';
import { isSessionHash } from './identity';

export interface PlannedWifi {
  /** Passed to tier context. Without a session hash this id is unique per emit so unknown radios are not glued together. */
  context: NativeWifiMatch;
  /** Card, map and vehicle key. Signature id when the platform gave no distinguishable access point. */
  match: NativeWifiMatch;
  apId?: string;
  radioId?: string;
  scanAt?: number;
  cached: boolean;
}

let anonSeq = 0;

/**
 * Strip anything that is not a per-session hash before Wi-Fi state, the map or the recorder sees it.
 * Scoring context for a missing hash uses a fresh in-memory id so persistence cannot climb by merging
 * unrelated radios, and so a missing hash cannot raise a score.
 */
export function planWifi(raw: NativeWifiMatch): PlannedWifi | null {
  const rules = Array.isArray(raw?.rules) ? raw.rules.map(String).filter(Boolean) : [];
  if (!rules.length) return null;
  const apId = isSessionHash(raw.id) ? raw.id : undefined;
  const radioId = isSessionHash(raw.radio) ? raw.radio : undefined;
  const scanAt = typeof raw.t === 'number' && Number.isFinite(raw.t) ? raw.t : undefined;
  const cached = raw.cached === true;
  const rssi = typeof raw.rssi === 'number' && Number.isFinite(raw.rssi) ? raw.rssi : undefined;
  const freq = typeof raw.freq === 'number' && Number.isFinite(raw.freq) ? raw.freq : undefined;
  const base = { rssi, rules, freq, t: scanAt, cached, radio: radioId, throttled: raw.throttled };
  return {
    context: { ...base, id: apId ?? `anon:${++anonSeq}` },
    match: { ...base, id: apId ?? `wifi:${rules[0]}` },
    apId, radioId, scanAt, cached,
  };
}
