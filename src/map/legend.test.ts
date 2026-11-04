import { describe, it, expect } from 'vitest';
import { legendHtml, loadLegendState, LEGEND } from './legend';
describe('legend', () => {
  it('collapsed by default, all categories present', () => {
    const st = loadLegendState(undefined); expect(st.open).toBe(false);
    const h = legendHtml(st); expect(h).not.toContain('class="lg" open'); for (const c of LEGEND) expect(h).toContain(c.title);
    expect(h).toContain('Strong'); expect(h).toMatch(/lg-peek.*Flock camera.*You.*Gear hit/); expect(h).toContain('Crowd cells');
  });
  it('restores saved state', () => {
    const st = loadLegendState({ getItem: () => JSON.stringify({ open: true, cats: { gear: false } }) });
    const h = legendHtml(st); expect(h).toContain('class="lg" open'); expect(h).toContain('data-cat="gear">'); expect(h).toContain('data-cat="wifi" open');
  });
  it('bad storage falls back', () => { expect(loadLegendState({ getItem: () => '{bad' }).open).toBe(false); });
});
