// Per-city chat. Room = city computed on device from the coarse grid cell (chat/room.ts). Backend = Supabase
// (supabase/migrations). Nothing about location, device IDs, MACs or Wi-Fi is sent; only room key + text.
import termsMd from '../../docs/chat-terms.md?raw';
import { miniMd } from './chat/md';
import { checkMessage, reasonText, MAX_LEN } from './chat/filter';
import { roomFor, loadCities, type Room } from './chat/room';
import { chatConfig, ChatClient, type ChatMsg } from './chat/client';
import { DemoChat } from './chat/demo';

type Api = Pick<ChatClient, 'uid' | 'signIn' | 'hasTerms' | 'acceptTerms' | 'recent' | 'subscribe' | 'unsubscribe' | 'post' | 'report' | 'block' | 'blocked'>;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? 'now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`; };

export function mountCityChat(getCell: () => { lat: number; lng: number } | undefined) {
  const btn = document.createElement('button');
  btn.id = 'open-chat'; btn.className = 'icon-btn'; btn.setAttribute('aria-label', 'City chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>';
  document.querySelector('.top')?.insertBefore(btn, document.getElementById('open-settings'));
  const el = document.createElement('section');
  el.id = 'chat'; el.className = 'chat'; el.hidden = true; el.setAttribute('aria-label', 'City chat');
  document.body.appendChild(el);

  let api: Api | undefined, room: Room | null = null, msgs: ChatMsg[] = [], blocked = new Set<string>(), roomTimer: number | undefined;
  const demo = new URLSearchParams(location.search).has('chatdemo');

  const shell = (title: string, sub: string, body: string) => {
    el.innerHTML = `<header><div><b>${esc(title)}</b><small>${esc(sub)}</small></div><button class="icon-btn x" aria-label="Close">✕</button></header>${body}`;
    el.querySelector('.x')!.addEventListener('click', close);
  };
  const notice = (title: string, text: string) => shell(title, 'City chat', `<div class="chat-empty"><p>${text}</p></div>`);

  const termsScreen = () => new Promise<void>(resolve => {
    shell('City chat rules', 'Read and agree to join', `<div class="terms">${miniMd(termsMd)}</div>
      <div class="terms-actions"><button class="ghost" id="terms-no">Not now</button><button class="send" id="terms-yes">I agree</button></div>`);
    el.querySelector('#terms-no')!.addEventListener('click', close);
    el.querySelector('#terms-yes')!.addEventListener('click', async () => { await api!.acceptTerms(); resolve(); });
  });

  const renderFeed = () => {
    const shown = msgs.filter(m => !blocked.has(m.user_id));
    const list = el.querySelector('.msgs');
    const html = shown.length ? shown.map(m => { const mine = m.user_id === api!.uid;
      return `<li class="${mine ? 'mine' : ''}"><div class="meta"><b>${esc(mine ? `You (${m.display_name})` : m.display_name)}</b> · ${ago(m.created_at)}${mine ? '' : ` <button class="more" data-id="${m.id}" aria-label="Report or block">⋯</button>`}</div><p>${esc(m.body)}</p></li>`; }).join('')
      : '<li class="empty">No messages in the last 24 hours. Say hi.</li>';
    if (list) { list.innerHTML = html; list.scrollTop = list.scrollHeight; }
    el.querySelectorAll<HTMLButtonElement>('.more').forEach(b => b.onclick = () => openMenu(msgs.find(m => m.id === +b.dataset.id!)!));
  };
  let cooldownUntil = 0, cdTimer = 0; const RATE_S = 10;
  const toast = (t: string, err = false) => { const n = el.querySelector<HTMLElement>('.note'); if (n) { n.textContent = t; n.classList.toggle('err', err); } };
  const openMenu = (m: ChatMsg) => {
    const menu = el.querySelector<HTMLElement>('.menu')!; menu.hidden = false;
    const act = async (f: () => Promise<unknown>, done: string) => { menu.hidden = true; try { await f(); toast(done); } catch (e: any) { toast(e.message ?? String(e), true); } };
    menu.querySelector<HTMLButtonElement>('[data-a=rm]')!.onclick = () => act(() => api!.report(m, 'message'), 'Thanks. Message reported to moderators.');
    menu.querySelector<HTMLButtonElement>('[data-a=ru]')!.onclick = () => act(() => api!.report(m, 'user'), 'Thanks. User reported to moderators.');
    menu.querySelector<HTMLButtonElement>('[data-a=bl]')!.onclick = () => act(async () => { await api!.block(m.user_id); blocked.add(m.user_id); renderFeed(); }, `Blocked ${m.display_name}. You won't see their posts.`);
    menu.querySelector<HTMLButtonElement>('.cancel')!.onclick = () => { menu.hidden = true; };
  };

  const feed = async (r: Room) => {
    room = r;
    shell(r.label, 'Local chat · city-level only · anonymous', `<div class="rules">Be civil. No threats, names, addresses, plates or phone numbers. Posts delete after 24 h. <a href="#" id="show-rules">Rules</a></div>
      <ol class="msgs"><li class="empty">Loading…</li></ol>
      <div class="menu" hidden><button data-a="rm">Report message</button><button data-a="ru">Report user</button><button data-a="bl">Block user</button><button class="cancel">Cancel</button></div>
      <form class="compose"><input placeholder="Message ${esc(r.label)}…" maxlength="${MAX_LEN}" enterkeyhint="send"/><button class="send" type="submit">Send</button></form>
      <div class="slowdown" role="status" aria-live="polite" hidden></div>
      <div class="note">1 message / 10 s · Your random name changes each day</div>`);
    el.querySelector('#show-rules')!.addEventListener('click', e => { e.preventDefault(); shell('City chat rules', r.label, `<div class="terms">${miniMd(termsMd)}</div><div class="terms-actions"><button class="send" id="back">Back to chat</button></div>`); el.querySelector('#back')!.addEventListener('click', () => void feed(r)); });
    const input = el.querySelector<HTMLInputElement>('.compose input')!;
    const sendBtn = el.querySelector<HTMLButtonElement>('.compose .send')!;
    const slow = el.querySelector<HTMLElement>('.slowdown')!;
    const tick = () => {
      const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (left > 0) { slow.hidden = false; slow.textContent = `Slow down: 1 message per ${RATE_S} seconds. You can send again in ${left}s.`; sendBtn.disabled = true; sendBtn.textContent = `${left}s`; }
      else { slow.hidden = true; sendBtn.disabled = false; sendBtn.textContent = 'Send'; clearInterval(cdTimer); cdTimer = 0; }
    };
    const startCooldown = (until: number) => { cooldownUntil = Math.max(cooldownUntil, until); tick(); if (!cdTimer) cdTimer = window.setInterval(tick, 250); };
    if (cooldownUntil > Date.now()) startCooldown(cooldownUntil);
    el.querySelector('form')!.addEventListener('submit', async e => {
      e.preventDefault();
      if (cooldownUntil > Date.now()) { startCooldown(cooldownUntil); slow.classList.remove('shake'); void slow.offsetWidth; slow.classList.add('shake'); return; }
      const why = checkMessage(input.value); if (why) { toast(reasonText[why], true); return; }
      try { await api!.post(r.key, input.value.trim()); input.value = ''; toast('Sent'); startCooldown(Date.now() + RATE_S * 1000); }
      catch (err: any) {
        const msg = String(err?.message ?? err);
        if (/rate limited/i.test(msg)) { const m = /(\d+)\s*s/.exec(msg); startCooldown(Date.now() + (m ? +m[1] : RATE_S) * 1000); return; }
        toast(/content policy/.test(msg) ? 'Blocked by the content policy.' : /banned/.test(msg) ? 'Your account is banned from chat.' : msg, true);
      }
    });
    msgs = await api!.recent(r.key); blocked = await api!.blocked(); renderFeed();
    api!.subscribe(r.key, m => { if (!msgs.some(x => x.id === m.id)) { msgs.push(m); renderFeed(); } }, id => { msgs = msgs.filter(m => m.id !== id); renderFeed(); });
  };

  const currentRoom = async () => { const cell = getCell(); return cell ? roomFor(cell, await loadCities()) : null; };

  async function open() {
    el.hidden = false;
    const cfg = chatConfig();
    if (!cfg && !demo) return notice('Chat not configured', 'City chat isn\u2019t switched on in this build yet. The rest of the app works as normal.');
    try {
      if (!api) { notice('City chat', 'Connecting…'); api = demo ? new DemoChat() : await ChatClient.create(cfg!); await api.signIn(); }
      const r = await currentRoom();
      if (!r) return notice('City chat', 'Waiting for your location. Chat opens to the city you\u2019re in (worked out on your phone from a ~150 m area, never your exact spot).');
      if (!(await api.hasTerms())) await termsScreen();
      await feed(r);
      clearInterval(roomTimer);
      roomTimer = window.setInterval(async () => { const n = await currentRoom(); if (n && room && n.key !== room.key && !el.hidden) void feed(n); }, 60_000);
    } catch (e: any) { notice('City chat', `Couldn\u2019t connect: ${esc(e?.message ?? String(e))}`); }
  }
  function close() { el.hidden = true; api?.unsubscribe(); clearInterval(roomTimer); }
  btn.onclick = () => (el.hidden ? void open() : close());
  if (location.hash === '#chat') void open();
}
