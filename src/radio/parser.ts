import type { ParsedEvent, Status } from './types';

/** Agency-specific 10-codes vary; this default is illustrative only. Override per feed. */
export const DEFAULT_TEN_CODES: Record<string, string> = {
  '10-50': 'traffic accident', '10-52': 'ambulance needed', '10-16': 'domestic disturbance',
  '10-31': 'crime in progress', '10-70': 'fire alarm',
};
const STATUS_CODES: Record<string, Status> = { '10-97': 'onscene', '10-23': 'onscene', '10-8': 'clear', '10-98': 'clear', '10-76': 'enroute' };
const CALL_KEYWORDS = ['traffic accident', 'accident', 'crash', 'domestic disturbance', 'disturbance', 'burglary', 'theft', 'alarm', 'fire', 'medical', 'shots fired', 'suspicious person', 'welfare check'];

const STREET = String.raw`(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|way|parkway|pkwy|highway|hwy)`;
const ADDRESS_RE = new RegExp(String.raw`\b(\d{1,6})\s+((?:[nsew]\.?\s+)?[a-z0-9]+(?:\s+[a-z0-9]+){0,3}?\s+${STREET})\b`, 'i');
const INTERSECTION_RE = new RegExp(String.raw`\b([a-z0-9]+(?:\s+[a-z0-9]+)?(?:\s+${STREET})?)\s+(?:and|&|at)\s+([a-z0-9]+(?:\s+[a-z0-9]+)?(?:\s+${STREET})?)\b`, 'i');

import { redact } from './redact';
/** Remove unit IDs, names, plates BEFORE any other processing. */
export const scrub = redact;

function detectStatus(t: string): Status {
  for (const [code, s] of Object.entries(STATUS_CODES)) if (new RegExp(`\\b${code}\\b`).test(t)) return s;
  if (/\bon scene\b|\barrived\b|\bon location\b/i.test(t)) return 'onscene';
  if (/\ben ?route\b|\bresponding\b/i.test(t)) return 'enroute';
  if (/\bclear(?:ing)?\b|\bback in service\b/i.test(t)) return 'clear';
  if (/\bdispatch(?:ed)?\b|\brespond to\b|\bsee the\b|\bcopy a\b/i.test(t)) return 'dispatched';
  return 'unknown';
}

export function parseTranscript(raw: string, now = Date.now(), tenCodes = DEFAULT_TEN_CODES): ParsedEvent | null {
  const t = scrub(raw).replace(/\s+/g, ' ').trim();
  let callType = '';
  for (const [code, label] of Object.entries(tenCodes)) if (new RegExp(`\\b${code}\\b`).test(t)) { callType = label; break; }
  if (!callType) callType = [...CALL_KEYWORDS].sort((a,b)=>b.length-a.length).find(k => new RegExp(`\\b${k}\\b`, 'i').test(t)) ?? '';
  const status = detectStatus(t);
  // Search for location only after "to"/"at"/"of" to avoid catching code numbers.
  const tail = t.replace(/\s*(?:,|\bfor\b|\bwith\b|\bregarding\b|\breference\b|\bon a\b).*?(?=\b(?:at|to|of)\b|$)/gi, ' ').replace(/\[(?:unit|person|plate|phone|dob)\]|\b10-\d+\b/g, ' ');
  let location: string | undefined;
  const a = tail.match(ADDRESS_RE);
  if (a) location = `${a[1]} ${a[2]}`.toLowerCase();
  else { const m = tail.match(/\b(?:at|to|of)\s+(.*)$/i); const i = (m ? m[1] : tail).match(INTERSECTION_RE); if (i && !/\d{2}-\d/.test(i[0])) location = `${i[1]} & ${i[2]}`.toLowerCase(); }
  if (!callType && !location && status === 'unknown') return null;
  return { callType: callType || 'unknown', location, status, timestamp: now };
}
