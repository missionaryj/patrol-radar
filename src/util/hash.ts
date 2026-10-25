// Per-session random salt: hashes cannot be correlated across sessions/reloads.
const salt = crypto.getRandomValues(new Uint8Array(16));
export async function ephemeralId(raw: string): Promise<string> {
  const data = new Uint8Array([...salt, ...new TextEncoder().encode(raw)]);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf).slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('');
}
