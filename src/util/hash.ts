// Per-session random salt: hashes cannot be correlated across scan sessions (or reloads).
// The salt is rotated on every scan start (rotateSalt), not just on page load: the Android WebView
// and a long-lived browser tab keep the module alive across many sessions.
let salt = crypto.getRandomValues(new Uint8Array(16));
let generation = 0;
export function rotateSalt(): number { salt = crypto.getRandomValues(new Uint8Array(16)); return ++generation; }
export const saltGeneration = () => generation;
export async function ephemeralId(raw: string): Promise<string> {
  const data = new Uint8Array([...salt, ...new TextEncoder().encode(raw)]);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf).slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('');
}
