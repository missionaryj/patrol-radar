import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEME_KEY, THEME_COLOR, readThemeChoice, resolveTheme, applyResolved, mountTheme, type ThemeDoc, type ThemeEnv } from './theme';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}
function fakeDoc() {
  const meta = { content: '', setAttribute: (_n: string, v: string) => { meta.content = v; } };
  const doc: ThemeDoc = {
    documentElement: { dataset: {}, style: { colorScheme: '', background: '' } },
    querySelector: sel => (sel === 'meta[name="theme-color"]' ? meta : null),
  };
  return { doc, meta };
}
function harness(systemDark: boolean, stored?: string) {
  const store = mem(); if (stored) store.setItem(THEME_KEY, stored);
  const { doc } = fakeDoc();
  const seen: string[] = [];
  let dark = systemDark;
  const listeners: Array<() => void> = [];
  const native = vi.fn();
  const win: ThemeEnv['win'] = {};
  const env: ThemeEnv = { store, systemDark: () => dark, listen: fn => listeners.push(fn), doc, win, native };
  const ctl = mountTheme(t => seen.push(t), env);
  return { ctl, doc, store, seen, native, win, setDark: (v: boolean) => { dark = v; }, fire: () => listeners.forEach(fn => fn()) };
}

describe('appearance theme', () => {
  it('defaults to match system and ignores unknown saved values', () => {
    expect(readThemeChoice(null)).toBe('system');
    expect(readThemeChoice('blue')).toBe('system');
    expect(readThemeChoice('light')).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('paints the resolved theme onto the document', () => {
    const { doc, meta } = fakeDoc();
    applyResolved('light', doc);
    expect(doc.documentElement.dataset.theme).toBe('light');
    expect(doc.documentElement.style.colorScheme).toBe('light');
    expect(doc.documentElement.style.background).toBe(THEME_COLOR.light);
    expect(meta.content).toBe(THEME_COLOR.light);
    applyResolved('dark', doc);
    expect(doc.documentElement.dataset.theme).toBe('dark');
    expect(doc.documentElement.style.background).toBe(THEME_COLOR.dark);
    expect(meta.content).toBe(THEME_COLOR.dark);
  });
  it('follows live system changes only while the choice is match system', () => {
    const h = harness(true);
    expect(h.ctl.choice()).toBe('system');
    expect(h.doc.documentElement.dataset.theme).toBe('dark');
    expect(h.native).toHaveBeenCalledWith('system', 'dark');
    h.setDark(false); h.fire();
    expect(h.doc.documentElement.dataset.theme).toBe('light');
    h.ctl.set('dark');
    expect(h.store.getItem(THEME_KEY)).toBe('dark');
    h.setDark(false); h.fire();
    expect(h.doc.documentElement.dataset.theme).toBe('dark');
    h.win.__prThemeSync?.(false);
    expect(h.doc.documentElement.dataset.theme).toBe('dark');
    h.ctl.set('system');
    h.win.__prThemeSync?.(false);
    expect(h.doc.documentElement.dataset.theme).toBe('light');
    h.win.__prThemeSync?.(true);
    expect(h.doc.documentElement.dataset.theme).toBe('dark');
  });
  it('restores a saved choice across a new mount', () => {
    const h = harness(true, 'light');
    expect(h.ctl.choice()).toBe('light');
    expect(h.doc.documentElement.dataset.theme).toBe('light');
    expect(h.seen).toEqual(['light']);
  });
  it('boots from the head script before the app module, using the same key', () => {
    const html = readFileSync('v2/index.html', 'utf8');
    const head = html.slice(0, html.indexOf('<body'));
    expect(head.indexOf(THEME_KEY)).toBeGreaterThan(-1);
    expect(head.indexOf(THEME_KEY)).toBeLessThan(head.indexOf('/src/v2/main.ts') === -1 ? head.length : head.indexOf('/src/v2/main.ts'));
    expect(head).toContain("prefers-color-scheme: dark");
    expect(head).toContain('dataset.theme');
    expect(html).toContain('id="theme"');
    expect(html).toContain('value="system"');
    expect(html).toContain('Match system');
  });
});
