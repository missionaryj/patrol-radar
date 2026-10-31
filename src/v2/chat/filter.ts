// Client-side content filter (the database has a matching backstop). Returns a reason or null.
// Phone-like only: 10 digits, or 11 with a leading 1, optionally separated. Not part of a longer digit run.
const PHONE = /(?<![\d+])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/;
const ADDRESS = /\b\d{1,6}\s+(?:[\w.'-]+\s){0,3}(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|boulevard|way|pl|place|cir|circle|ter|terrace|pkwy|parkway|hwy|highway)\b\.?/i;
// Plates: 2-3 letters + 3-4 digits (or reverse), optionally separated, e.g. "ABC 1234", "1234-XYZ", "plate 7KJM392".
const PLATE = /\b(?:[A-Z]{2,3}[\s-]?\d{3,4}|\d{3,4}[\s-]?[A-Z]{2,3}|\d[A-Z]{3}\d{3})\b|\b(?:plate|tag|license)\s*(?:#|no\.?|number)?\s*[:\-]?\s*[A-Z0-9]{5,8}\b/i;
const THREAT = /\b(kill|shoot|stab|murder|bomb|hurt|attack|jump|ambush|dox+|swat)\w*\b.{0,30}\b(him|her|them|cops?|officers?|police|pigs?|you|deputy|trooper)\b|\b(going to|gonna|i'?ll|lets?)\s+(kill|shoot|stab|hurt|beat)\b/i;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/;

export type FilterReason = 'threat' | 'address' | 'plate' | 'phone' | 'email' | 'empty' | 'too long';
export const MAX_LEN = 280;
export function checkMessage(text: string): FilterReason | null {
  const t = text.trim();
  if (!t) return 'empty';
  if (t.length > MAX_LEN) return 'too long';
  if (THREAT.test(t)) return 'threat';
  if (PHONE.test(t)) return 'phone';
  if (ADDRESS.test(t)) return 'address';
  if (EMAIL.test(t)) return 'email';
  if (PLATE.test(t.toUpperCase()) && PLATE.test(t)) return 'plate';
  return null;
}
export const reasonText: Record<FilterReason, string> = {
  threat: 'Threats or calls for violence are not allowed.',
  address: 'Street addresses are not allowed. Name a general area instead (e.g. "near campus").',
  plate: 'License plates are not allowed.',
  phone: 'Phone numbers are not allowed.',
  email: 'Email addresses are not allowed.',
  empty: 'Type a message first.',
  'too long': `Keep it under ${MAX_LEN} characters.`,
};
