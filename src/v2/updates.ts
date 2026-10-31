/** App updates feed. Posts come from a static JSON file; read state lives only in this browser's localStorage. */
export interface UpdatePost { id: string; date: string; title: string; body: string; }
export const READ_KEY = 'pr.updates.read';
/** The app bundle can't change without a new build, so the Android app reads the live web copy (falls back to the bundled one). */
export const LIVE_UPDATES_URL = 'https://missionaryj.github.io/patrol-radar/updates.json';

export function normalize(raw: unknown): UpdatePost[] {
  const posts = (raw as any)?.posts; if (!Array.isArray(posts)) return [];
  return posts.filter(p => p && typeof p.id === 'string' && typeof p.title === 'string')
    .map(p => ({ id: p.id, date: String(p.date ?? ''), title: p.title, body: String(p.body ?? '') }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function readIds(ls: Pick<Storage, 'getItem'>): Set<string> {
  try { const v = JSON.parse(ls.getItem(READ_KEY) ?? '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
}
export function markRead(ls: Pick<Storage, 'getItem' | 'setItem'>, ids: string[]) {
  const s = readIds(ls); ids.forEach(i => s.add(i)); ls.setItem(READ_KEY, JSON.stringify([...s].slice(-200)));
}
export const unreadCount = (posts: UpdatePost[], read: Set<string>) => posts.filter(p => !read.has(p.id)).length;

export async function loadUpdates(urls: string[], f: typeof fetch = fetch): Promise<UpdatePost[]> {
  for (const u of urls) {
    try { const r = await f(u, { cache: 'no-cache' }); if (r.ok) return normalize(await r.json()); } catch { /* try next */ }
  }
  return [];
}

export const DEBUG_EMAIL = 'percolatorbiz@gmail.com';
export function debugMailto(appVersion: string): string {
  const subject = `Patrol Radar debug session`;
  const body = [
    'What I saw (e.g. 2 patrol cars, an officer on foot, parked squad car):',
    '',
    'Roughly when (date + time):',
    '',
    'Roughly where (city / area is enough):',
    '',
    'App: ' + appVersion,
    '',
    'IMPORTANT: attach the exported patrol-radar-session-….json file before sending.',
  ].join('\n');
  return `mailto:${DEBUG_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
