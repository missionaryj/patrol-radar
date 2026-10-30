import { describe, it, expect } from 'vitest';
import { normalize, readIds, markRead, unreadCount, loadUpdates, debugMailto, DEBUG_EMAIL } from './updates';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
describe('updates feed', () => {
  it('sorts newest first and drops bad posts', () => {
    const p = normalize({ posts: [{ id: 'a', date: '2026-01-01', title: 'A' }, { id: 'b', date: '2026-02-01', title: 'B', body: 'x' }, { nope: 1 }] });
    expect(p.map(x => x.id)).toEqual(['b', 'a']);
    expect(normalize(null)).toEqual([]);
  });
  it('tracks read state locally', () => {
    const ls = mem(); const posts = normalize({ posts: [{ id: 'a', date: '1', title: 'A' }, { id: 'b', date: '2', title: 'B' }] });
    expect(unreadCount(posts, readIds(ls))).toBe(2); markRead(ls, ['a']); expect(unreadCount(posts, readIds(ls))).toBe(1);
    ls.setItem('pr.updates.read', 'garbage'); expect(readIds(ls).size).toBe(0);
  });
  it('falls back to the next URL', async () => {
    const f = (async (u: string) => u === 'bad' ? { ok: false } : { ok: true, json: async () => ({ posts: [{ id: 'x', date: '1', title: 'X' }] }) }) as any;
    expect((await loadUpdates(['bad', 'good'], f))[0].id).toBe('x');
  });
  it('mailto targets the debug inbox with a template', () => {
    const m = debugMailto('1.0.15'); expect(m.startsWith(`mailto:${DEBUG_EMAIL}?subject=Patrol%20Radar%20debug%20session`)).toBe(true);
    expect(decodeURIComponent(m)).toContain('attach the exported');
  });
});
