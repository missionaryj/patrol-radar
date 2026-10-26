import type { Advertisement } from './types';
import { ephemeralId } from '../util/hash';

/** Accepts Map, plain object, or array-of-pairs; keys may be numbers or "0x034d"/"845" strings. */
function toEntries(x: any): [any, any][] {
  if (!x) return [];
  if (x instanceof Map || typeof x.forEach === 'function' && !Array.isArray(x) && typeof x.entries === 'function') return [...x.entries()];
  if (Array.isArray(x)) return x as [any, any][];
  return Object.entries(x);
}
function toDataView(v: any): DataView {
  if (v instanceof DataView) return v;
  if (v instanceof ArrayBuffer) return new DataView(v);
  if (ArrayBuffer.isView(v)) return new DataView(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return new DataView(new Uint8Array(v).buffer);
  if (typeof v === 'string') { // hex string fallback
    const h = v.replace(/[^0-9a-f]/gi, ''); return new DataView(new Uint8Array(h.match(/../g)?.map(b => parseInt(b, 16)) ?? []).buffer);
  }
  return new DataView(new ArrayBuffer(0));
}
function toCompanyId(k: any): number { return typeof k === 'number' ? k : /^0x/i.test(k) ? parseInt(k, 16) : parseInt(k, 10); }
/** 16-bit "fc81"/"0xFC81"/0xfc81 → full 128-bit lowercase. */
export function normUuid(u: any): string {
  if (typeof u === 'number') return `0000${u.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
  const s = String(u).toLowerCase().replace(/^0x/, '');
  if (/^[0-9a-f]{4}$/.test(s)) return `0000${s}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}$/.test(s)) return `${s}-0000-1000-8000-00805f9b34fb`;
  return s;
}

/** Converts a Web Bluetooth / Bluefy advertisement event into our Advertisement. Raw ids are hashed, never kept. */
export async function normalizeEvent(e: any): Promise<Advertisement> {
  const manufacturerData = new Map<number, DataView>();
  for (const [k, v] of toEntries(e.manufacturerData)) { const id = toCompanyId(k); if (!Number.isNaN(id)) manufacturerData.set(id, toDataView(v)); }
  const serviceData = new Map<string, DataView>();
  for (const [k, v] of toEntries(e.serviceData)) serviceData.set(normUuid(k), toDataView(v));
  const uuids = (e.uuids ?? e.serviceUuids ?? []) as any[];
  return {
    sessionId: await ephemeralId(String(e.device?.id ?? e.id ?? e.deviceId ?? 'unknown')),
    name: e.name ?? e.device?.name ?? undefined,
    rssi: typeof e.rssi === 'number' ? e.rssi : undefined,
    txPower: typeof e.txPower === 'number' ? e.txPower : undefined,
    manufacturerData, serviceUuids: uuids.map(normUuid), serviceData, timestamp: Date.now(),
  };
}
