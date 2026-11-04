/** One collapsible, categorised map legend shared by v1 and v2. Only open/closed state is stored locally. */
export const LEGEND_KEY = 'pr.legend.v1';
interface Item { sw: string; label: string }
export interface LegendCat { id: string; title: string; items: Item[] }
const dot = (bg: string, extra = '') => `<i class="lg-sw" style="background:${bg};${extra}"></i>`;
export const LEGEND: LegendCat[] = [
  { id: 'gear', title: 'Police gear', items: [
    { sw: dot('#e53935'), label: 'Axon' }, { sw: dot('#fb8c00'), label: 'Radio' },
    { sw: dot('#ab47bc'), label: 'ALPR' }, { sw: dot('#fdd835'), label: 'Other' }, { sw: dot('#8a9bb0'), label: 'Unknown' }] },
  { id: 'wifi', title: 'Wi-Fi', items: [
    { sw: dot('transparent', 'border:2px dashed #2979ff'), label: 'Wi-Fi hit' }, { sw: dot('#2979ff'), label: 'Cradlepoint' }] },
  { id: 'veh', title: 'Vehicles', items: [{ sw: '<span class="lg-em">🚓</span>', label: 'Grouped' }] },
  { id: 'crowd', title: 'Crowd', items: [
    { sw: '<i class="lg-sw lg-sq" style="background:rgba(176,60,255,.32);border:2px solid #b03cff"></i>', label: 'Recent' },
    { sw: '<i class="lg-sw lg-sq" style="background:rgba(176,60,255,.08);border:1px dashed #b03cff"></i>', label: 'Fading' }] },
  { id: 'me', title: 'Location', items: [
    { sw: dot('transparent', 'border:1px solid #aaa'), label: '± circle' }, { sw: dot('transparent', 'border:1px dashed #aaa'), label: 'Approx.' }] },
  { id: 'grade', title: 'Confidence', items: [
    { sw: '<b class="lg-g">S</b>', label: 'Strong' }, { sw: '<b class="lg-g">L</b>', label: 'Likely' }, { sw: '<b class="lg-g">H</b>', label: 'Hint' }] },
];
/** Always-visible preview row (collapsed and expanded). */
export const PEEK: Item[] = [
  { sw: dot('#0b3d4a', 'border:2px solid #00e5ff;box-sizing:border-box'), label: 'Flock camera' },
  { sw: dot('#2a7fff', 'border:2px solid #fff;box-sizing:border-box'), label: 'You' },
  { sw: dot('rgba(238,51,51,.45)', 'border:1.5px solid #e33;box-sizing:border-box'), label: 'Gear hit' },
];
export interface LegendState { open: boolean; cats: Record<string, boolean> }
export function loadLegendState(s: Pick<Storage, 'getItem'> | undefined): LegendState {
  try { const v = JSON.parse(s?.getItem(LEGEND_KEY) ?? ''); if (v && typeof v.open === 'boolean') return { open: v.open, cats: v.cats ?? {} }; } catch { /* default */ }
  return { open: false, cats: {} };
}
export function legendHtml(st: LegendState, cats = LEGEND): string {
  return `<details class="lg"${st.open ? ' open' : ''}><summary class="lg-head"><span class="lg-top"><span>Legend</span><span class="lg-chev" aria-hidden="true"></span></span><span class="lg-peek">${PEEK.map(i => `<span>${i.sw}${i.label}</span>`).join('')}</span></summary><div class="lg-body">${
    cats.map(c => `<details class="lg-cat" data-cat="${c.id}"${st.cats[c.id] === true ? ' open' : ''}><summary>${c.title}<span class="lg-chev" aria-hidden="true"></span></summary>${`<div class="lg-grid">${c.items.map(i => `<div class="lg-row">${i.sw}<span>${i.label}</span></div>`).join('')}</div>`}</details>`).join('')
  }</div></details>`;
}
/** Render into el and persist toggles. */
export function mountLegend(el: HTMLElement, store: Storage | undefined = globalThis.localStorage) {
  const st = loadLegendState(store); el.innerHTML = legendHtml(st);
  const save = () => { try { store?.setItem(LEGEND_KEY, JSON.stringify(st)); } catch { /* ignore */ } };
  const top = el.querySelector('details.lg') as HTMLDetailsElement;
  top.addEventListener('toggle', () => { st.open = top.open; save(); });
  el.querySelectorAll<HTMLDetailsElement>('details.lg-cat').forEach(d => d.addEventListener('toggle', () => { st.cats[d.dataset.cat!] = d.open; save(); }));
}
