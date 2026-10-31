// UI-only mockup of a per-city chat feed. Mock data, no backend, nothing is sent or stored.
// Privacy model (planned): room key = city name derived from the coarse grid cell, never precise location;
// author shown only as a per-room salted handle that rotates; no device IDs, MACs or names attached.
type Msg = { id: string; who: string; mins: number; text: string; mine?: boolean; flagged?: boolean };
const MOCK: Msg[] = [
  { id: '1', who: 'Teal Fox', mins: 42, text: 'Flock camera at Neil & Kirby is back online, saw it light up on the map.' },
  { id: '2', who: 'Amber Owl', mins: 31, text: 'Anyone else getting Axon hits near campus town tonight?' },
  { id: '3', who: 'Slate Heron', mins: 27, text: 'Yeah, 2 weak ones on Green St around 7:50.' },
  { id: '4', who: 'Hidden', mins: 15, text: 'Message hidden: it included an officer\u2019s personal details.', flagged: true },
  { id: '5', who: 'You', mins: 4, text: 'Thanks, heading the other way.', mine: true },
];
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export function mountCityChat(city = 'Champaign, IL') {
  const btn = document.createElement('button');
  btn.id = 'open-chat'; btn.className = 'icon-btn'; btn.setAttribute('aria-label', 'City chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>';
  const top = document.querySelector('.top'); const set = document.getElementById('open-settings');
  top?.insertBefore(btn, set);
  const el = document.createElement('section');
  el.id = 'chat'; el.className = 'chat'; el.hidden = true; el.setAttribute('aria-label', 'City chat');
  const render = () => {
    el.innerHTML = `<header><div><b>${esc(city)}</b><small>Local chat · city-level only · mockup</small></div>
      <button class="icon-btn x" aria-label="Close">✕</button></header>
      <div class="rules">Be civil. No threats, no officer names, addresses, plates or photos. Posts auto-delete after 24 h. <a href="#">Rules</a></div>
      <ol class="msgs">${MOCK.map(m => `<li class="${m.mine ? 'mine' : ''}${m.flagged ? ' flag' : ''}"><div class="meta"><b>${esc(m.who)}</b> · ${m.mins}m ago${m.mine || m.flagged ? '' : ` <button class="more" data-id="${m.id}" aria-label="Report or block">⋯</button>`}</div><p>${esc(m.text)}</p></li>`).join('')}</ol>
      <div class="menu" hidden><button>Report message</button><button>Report user</button><button>Block user</button><button class="cancel">Cancel</button></div>
      <form class="compose"><input placeholder="Message ${esc(city)}…" maxlength="280"/><button class="send" type="submit">Send</button></form>
      <div class="note">1 message / 30 s · You appear as a random name that changes each day</div>`;
    el.querySelector('.x')!.addEventListener('click', () => { el.hidden = true; });
    const menu = el.querySelector<HTMLElement>('.menu')!;
    el.querySelectorAll('.more').forEach(b => b.addEventListener('click', () => { menu.hidden = false; }));
    menu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { menu.hidden = true; }));
    el.querySelector('form')!.addEventListener('submit', e => e.preventDefault());
  };
  render(); document.body.appendChild(el);
  btn.onclick = () => { el.hidden = !el.hidden; };
}
