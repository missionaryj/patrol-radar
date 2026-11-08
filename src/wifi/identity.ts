/**
 * Per-session Wi-Fi identity. The native watcher hashes a BSSID with the scan-session salt and drops the
 * address before anything is stored. This module only accepts that hash shape. A MAC, SSID, serial or rule
 * name is not an access-point id and is never written into a record.
 *
 * One hashed access point is not one vehicle or one officer. Several access points can ride in one vehicle,
 * one device can rotate through many ids, and the same signature can be a bus, a router or a patrol car.
 */
export const SESSION_HASH = /^n[0-9a-f]{16}$/;

export type WifiIdentityKind = 'ap' | 'signature';
export type WifiRetention = 'session' | 'buffered' | 'history';
export type WifiTimeSource = 'scan' | 'received';

/** Shown on a Wi-Fi card, map popup and log. Never equates one radio with one car. */
export const WIFI_EVIDENCE_LINE = 'One access point. Several can be in one vehicle, and one device can use more than one id. Not a car or officer count.';
/** Shown on an inferred vehicle card and map popup. */
export const VEHICLE_EVIDENCE_LINE = 'Radios in the same area and time. Not a verified count of vehicles or officers.';
/** Shown next to the arrival / left buttons. */
export const SIGHTING_NOTE = 'Time you saw a vehicle come or go. Not tied to a radio, and not a count of cars.';

export function isSessionHash(id: string | undefined | null): id is string {
  return typeof id === 'string' && SESSION_HASH.test(id);
}

/** Record key. A real per-session hash stays itself. Anything else collapses to the signature id. */
export function wifiDev(ruleId: string, apId?: string | null): { dev: string; identity: WifiIdentityKind; apId?: string } {
  if (isSessionHash(apId)) return { dev: apId, identity: 'ap', apId };
  return { dev: `wifi:${ruleId}`, identity: 'signature' };
}

/** Native cache window is 120s. A little slack for clock skew; older stamps are not trusted as scan times. */
export const WIFI_SCAN_SKEW_MS = 5_000;
export const WIFI_SCAN_MAX_AGE_MS = 130_000;

/**
 * Pick the time to store and whether this row is from the current recording, the OS scan cache,
 * or the in-app buffer from before Record was on.
 * Buffered wins over history: a cached scan is not a live sighting in this session.
 */
export function classifyWifiTime(o: {
  scanAt?: number;
  receivedAt: number;
  scanStartedAt?: number;
  recordingStartedAt?: number;
  cached?: boolean;
  recording: boolean;
}): { t: number; retention: WifiRetention; timeSource: WifiTimeSource } {
  const scanOk = typeof o.scanAt === 'number' && Number.isFinite(o.scanAt)
    && o.scanAt <= o.receivedAt + WIFI_SCAN_SKEW_MS
    && o.receivedAt - o.scanAt <= WIFI_SCAN_MAX_AGE_MS;
  const t = scanOk ? o.scanAt! : o.receivedAt;
  const timeSource: WifiTimeSource = scanOk ? 'scan' : 'received';
  const beforeScan = typeof o.scanStartedAt === 'number' && Number.isFinite(o.scanStartedAt) && t < o.scanStartedAt;
  if (o.cached || beforeScan) return { t, retention: 'buffered', timeSource };
  const beforeRecording = !o.recording || (typeof o.recordingStartedAt === 'number' && t < o.recordingStartedAt);
  if (beforeRecording) return { t, retention: 'history', timeSource };
  return { t, retention: 'session', timeSource };
}
