import { describe, it, expect } from 'vitest';
import { STEPS, TutorialState, cardSide, shouldAutoShow, markTutorialDone, tutorialDone, TUTORIAL_KEY } from './tutorial';
import { readFileSync } from 'node:fs';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
describe('tutorial', () => {
  it('has 5-7 steps with unique ids and real v2 targets', () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(5); expect(STEPS.length).toBeLessThanOrEqual(7);
    expect(new Set(STEPS.map(s => s.id)).size).toBe(STEPS.length);
    const html = readFileSync('v2/index.html', 'utf8') + readFileSync('src/v2/cityChat.ts', 'utf8');
    for (const s of STEPS) if (s.target) expect(html).toContain(s.target.slice(1));
  });
  it('covers privacy, scan, legend, cards, bell, travel mode and chat', () => {
    const all = STEPS.map(s => s.body).join(' ');
    for (const w of ['Receive-only', 'Scan', 'Record', 'Flock camera', 'legend', 'RSSI', 'app news', 'On foot', 'Car', '3D buildings', 'chat']) expect(all).toContain(w);
  });
  it('steps forward/back within bounds', () => {
    const t = new TutorialState(3); expect(t.first).toBe(true); t.back(); expect(t.i).toBe(0);
    t.next(); t.next(); t.next(); expect(t.i).toBe(2); expect(t.last).toBe(true); t.back(); expect(t.i).toBe(1);
  });
  it('shows once until skipped or done', () => {
    const s = mem(); expect(shouldAutoShow(s)).toBe(true); expect(tutorialDone(s)).toBe(false);
    markTutorialDone(s); expect(s.getItem(TUTORIAL_KEY)).toBe('1'); expect(shouldAutoShow(s)).toBe(false);
    expect(shouldAutoShow(mem(), '?autostart=1')).toBe(true);
    expect(shouldAutoShow(s, '')).toBe(false); // same flag still blocks a later app launch
  });
  it('auto-opens on the first Patrol Radar entry, not on the mode picker', () => {
    const main = readFileSync('src/v2/main.ts', 'utf8');
    expect(main).not.toContain('setTimeout(tour.open');
    const choose = main.split('function chooseExperience(')[1].split('\n}')[0];
    expect(choose).toContain("if(mode==='patrol') showPatrolTour()");
    expect(choose).not.toContain('tour.open');
    const back = main.split('function showModeChoices()')[1].split('\n}')[0];
    expect(back).toContain('hidePatrolTour()');
    expect(main).toContain("$('replay-tour').onclick = () => { setSettings(false); tour.open(); }");
    expect(main).toContain('if (shouldAutoShow(localStorage, location.search) && !location.hash) tour.open()');
    expect(main).toContain('hidePatrolTour = () => tour.hide()');
  });
  it('puts the card opposite the highlighted control', () => {
    expect(cardSide(undefined, 800)).toBe('below');
    expect(cardSide({ top: 10, bottom: 50 }, 800)).toBe('below');
    expect(cardSide({ top: 600, bottom: 700 }, 800)).toBe('above');
  });
});
