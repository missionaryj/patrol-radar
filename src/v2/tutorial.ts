/** Optional first-run walkthrough (v2). Shown on the first Patrol Radar entry, not the mode picker. Skippable; a saved flag stops it re-appearing. */
export interface TutorialStep { id: string; title: string; body: string; target?: string }
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export const TUTORIAL_KEY = 'pr.tutorial.done';

export const STEPS: TutorialStep[] = [
  { id: 'welcome', title: 'Welcome to Patrol Radar', body: 'A passive map of police gear nearby: body cams, radios and in-car Wi-Fi heard over Bluetooth (and Wi-Fi in the Android app). Receive-only: it never connects or pairs, saved locations are ~200 m areas, and nothing personal is stored.' },
  { id: 'scan', target: '#scan', title: 'Scan', body: 'Tap <b>Scan</b> to start listening and <b>Stop</b> to end. The pill at the top shows Idle / Scanning and the gear count. To send a debug file, open Live detections and tap <b>● Record</b>.' },
  { id: 'map', target: '#map-legend', title: 'Reading the map', body: 'Your location dot is <b>You</b>; red pins are <b>Gear hits</b>; <b>Flock camera</b> marks mapped plate readers. Tap the legend to expand its categories. ◎ recenters and follows you; <b>3D</b> tilts the map.' },
  { id: 'sheet', target: '#sheet', title: 'Live detections', body: 'Swipe up or tap the handle. Each card shows a grade (<b>strong</b>, <b>likely</b>, <b>hint</b>), a confidence %, signal (<b>RSSI</b>) and rough range (📍 ~m). Grouped signals appear as one 🚓 Vehicle card. The list scrolls on its own.' },
  { id: 'bell', target: '#open-updates', title: 'Updates & Accuracy reports', body: 'The bell shows app news, with a dot when something is new. The <b>Accuracy reports</b> tab explains how reliable each detection type is.' },
  { id: 'settings', target: '#open-settings', title: 'Settings', body: 'Set <b>Travel mode</b> to <b>Car</b> or <b>On foot</b> (shorter range, stricter filtering). <b>3D buildings</b> is on by default. You can also adjust scan mode, sounds, layers and replay this tutorial here.' },
  { id: 'chat', target: '#open-chat', title: 'City chat', body: 'Anonymous, city-level chat with people nearby. Be civil: no names, plates or addresses. Posts delete after 24 h. That’s it, enjoy.' },
];

export const tutorialDone = (s: Store) => s.getItem(TUTORIAL_KEY) === '1';
export const markTutorialDone = (s: Store) => s.setItem(TUTORIAL_KEY, '1');
export const shouldAutoShow = (s: Store, search = '') => !tutorialDone(s) && !/[?&]notour=/.test(search);

/** Pure step state machine (tested without a DOM). */
export class TutorialState {
  i = 0;
  constructor(readonly n: number) {}
  get first() { return this.i === 0; }
  get last() { return this.i === this.n - 1; }
  next() { if (!this.last) this.i++; return this.i; }
  back() { if (!this.first) this.i--; return this.i; }
}

/** Card goes on the opposite half of the screen from the highlighted control. */
export function cardSide(rect: { top: number; bottom: number } | undefined, vh: number): 'above' | 'below' {
  if (!rect) return 'below';
  return (rect.top + rect.bottom) / 2 > vh / 2 ? 'above' : 'below';
}

export function mountTutorial(o: { store?: Store; steps?: TutorialStep[]; onStep?: (s: TutorialStep) => void } = {}) {
  const store = o.store ?? localStorage, steps = o.steps ?? STEPS;
  let root: HTMLElement | undefined, st: TutorialState, onResize: (() => void) | undefined;
  const detach = () => { root?.remove(); root = undefined; if (onResize) { removeEventListener('resize', onResize); onResize = undefined; } };
  const close = () => { markTutorialDone(store); detach(); };
  const render = () => {
    if (!root) return;
    const s = steps[st.i]; o.onStep?.(s);
    const el = s.target ? document.querySelector<HTMLElement>(s.target) : null;
    const r = el && el.getClientRects().length ? el.getBoundingClientRect() : undefined;
    const ring = root.querySelector<HTMLElement>('.tour-ring')!;
    ring.hidden = !r;
    if (r) { const p = 6; Object.assign(ring.style, { top: `${r.top - p}px`, left: `${r.left - p}px`, width: `${r.width + 2 * p}px`, height: `${Math.min(r.height, innerHeight - r.top) + 2 * p}px` }); }
    root.querySelector('.tour-card')!.className = `tour-card ${cardSide(r, innerHeight)}`;
    root.querySelector('.tour-title')!.innerHTML = s.title;
    root.querySelector('.tour-body')!.innerHTML = s.body;
    root.querySelector('.tour-step')!.textContent = `${st.i + 1} / ${steps.length}`;
    root.querySelector('.tour-dots')!.innerHTML = steps.map((_, k) => `<i class="${k === st.i ? 'on' : ''}"></i>`).join('');
    (root.querySelector('#tour-back') as HTMLButtonElement).hidden = st.first;
    root.querySelector('#tour-next')!.textContent = st.last ? 'Done' : 'Next';
  };
  const open = () => {
    if (root) return;
    st = new TutorialState(steps.length);
    root = document.createElement('div'); root.id = 'tour'; root.className = 'tour';
    root.innerHTML = `<div class="tour-ring" hidden></div>
      <div class="tour-card below" role="dialog" aria-modal="false" aria-labelledby="tour-title">
        <div class="tour-top"><span class="tour-step"></span><button type="button" id="tour-skip" class="tour-skip">Skip</button></div>
        <h3 id="tour-title" class="tour-title"></h3><p class="tour-body"></p>
        <div class="tour-foot"><div class="tour-dots" aria-hidden="true"></div><div class="tour-nav"><button type="button" id="tour-back" class="ghost">Back</button><button type="button" id="tour-next" class="send">Next</button></div></div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector('#tour-skip')!.addEventListener('click', close);
    root.querySelector('#tour-back')!.addEventListener('click', () => { st.back(); render(); });
    root.querySelector('#tour-next')!.addEventListener('click', () => { if (st.last) close(); else { st.next(); render(); } });
    addEventListener('resize', onResize = render);
    render();
  };
  return { open, close, hide: detach, get step() { return root ? st.i : -1; } };
}
