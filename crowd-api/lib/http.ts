const env = (k: string) => (globalThis as any).process?.env?.[k] as string | undefined;
const ORIGINS = ['https://missionaryj.github.io', 'capacitor://localhost', 'http://localhost', 'https://localhost', 'http://localhost:5173'];
export function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  const h: Record<string, string> = { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type,x-crowd-test-key', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
  if (ORIGINS.includes(o)) h['Access-Control-Allow-Origin'] = o;
  return h;
}
export const json = (req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(req), ...extra } });
/** Test mode is enabled only while the CROWD_TEST_KEY env var is set (removed after E2E checks). */
export function isTest(req: Request) { const k = env('CROWD_TEST_KEY'); return !!k && k.length >= 16 && req.headers.get('x-crowd-test-key') === k; }
/** Short-lived salted hash of the client IP, used only as a rate-limit counter key. The raw IP is never stored or logged. */
const SALT = crypto.getRandomValues(new Uint8Array(16)).join('.');
export async function ipKey(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${SALT}|${new Date().toISOString().slice(0, 13)}|${ip}`));
  return Array.from(new Uint8Array(d).slice(0, 8), x => x.toString(16).padStart(2, '0')).join('');
}
