// Live chat stress in a dedicated test room only. node scripts/stress/chat-stress.mjs [users]
import { createClient } from '@supabase/supabase-js';
const URL = 'https://vfqmoobjjsdeivhcgurx.supabase.co', KEY = 'sb_publishable_wQYhoGMbpsfV6KqJQr74Tg_-d_AF2jt';
const ROOM = 'US-ZZ-stresstest'; const N = +(process.argv[2] ?? 30); const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const err = e => e ? `${e.code ?? ''} ${e.message}`.trim() : 'ok';
const users = []; const counts = {};
const tally = (k) => { counts[k] = (counts[k] ?? 0) + 1; };
// 1) sign in + terms
for (let i = 0; i < N; i++) {
  const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const a = await sb.auth.signInAnonymously(); if (a.error) { log('signin fail', i, err(a.error)); tally('signin-fail'); break; }
  const t = await sb.from('terms_acceptances').insert({ version: 1 }); if (t.error) tally('terms-fail');
  users.push({ sb, id: a.data.user.id, recv: new Map() });
}
log('users', users.length);
// 2) all subscribe
const sent = new Map(); // id -> send time
await Promise.all(users.map(u => new Promise(res => {
  u.ch = u.sb.channel('room:' + ROOM).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room=eq.${ROOM}` }, p => u.recv.set(p.new.id, performance.now()))
    .subscribe(s => { if (s === 'SUBSCRIBED') res(); else if (s !== 'SUBSCRIBED') log('sub', s); });
})));
log('subscribed all'); await sleep(1500);
const post = async (u, body) => { const t = performance.now(); const r = await u.sb.from('messages').insert({ room: ROOM, body }).select('id').single();
  if (r.error) return { ok: false, e: r.error.message, ms: performance.now() - t }; sent.set(r.data.id, t); return { ok: true, id: r.data.id, ms: performance.now() - t }; };
// 3) burst: every user posts once at the same moment
const burst = await Promise.all(users.map((u, i) => post(u, `stress burst ${i}`)));
log('burst ok', burst.filter(r => r.ok).length, '/', burst.length, 'insert p50 ms', pct(burst.map(r => r.ms), .5), 'p95', pct(burst.map(r => r.ms), .95));
function pct(a, p) { a = [...a].sort((x, y) => x - y); return Math.round(a[Math.floor((a.length - 1) * p)] ?? NaN); }
// 4) rate limit: immediate 2nd post (sequential) and a 5-way parallel race from one fresh-limit user
const second = await Promise.all(users.slice(0, 10).map(u => post(u, 'stress second')));
log('10s limit sequential: rejected', second.filter(r => !r.ok).length, '/10', second.find(r => !r.ok)?.e);
await sleep(10500);
const race = await Promise.all(Array.from({ length: 5 }, (_, k) => post(users[1], 'stress race ' + k)));
log('10s limit parallel race (5 at once, one user): accepted', race.filter(r => r.ok).length, race.filter(r => !r.ok).map(r => r.e)[0] ?? '');
await sleep(3000);
// fan-out latency
const lat = []; let missing = 0;
for (const [id, t] of sent) for (const u of users) { const r = u.recv.get(id); if (r === undefined) missing++; else lat.push(r - t); }
log('fanout deliveries', lat.length, 'missing', missing, 'latency ms p50', pct(lat, .5), 'p95', pct(lat, .95), 'max', Math.round(Math.max(...lat)));
// 5) report-hides-at-3
const target = burst.find(r => r.ok).id; const owner = users[burst.findIndex(r => r.ok)];
const vis = async u => (await u.sb.from('messages').select('id').eq('id', target)).data?.length;
for (let k = 1; k <= 3; k++) { const rep = users[(users.indexOf(owner) + k) % users.length]; const r = await rep.sb.from('reports').insert({ kind: 'message', message_id: target, reason: 'stress test' });
  log(`report ${k}`, err(r.error), 'visible to others:', await vis(users[(users.indexOf(owner) + 5) % users.length])); }
const dup = await users[(users.indexOf(owner) + 1) % users.length].sb.from('reports').insert({ kind: 'message', message_id: target, reason: 'dup' }); log('duplicate report', err(dup.error));
const self = await owner.sb.from('reports').insert({ kind: 'message', message_id: target }); log('self report', err(self.error));
// 6) new-account daily cap 20: 2 users post 21 more at 10.5 s spacing (already posted 1-2)
const capUsers = [users[2], users[3]]; const capRes = capUsers.map(() => []);
const already = await Promise.all(capUsers.map(async u => (await u.sb.from('messages').select('id', { count: 'exact', head: true }).eq('user_id', u.id)).count));
log('cap test start, already posted', already);
for (let k = 0; k < 21; k++) { await sleep(10500); const rs = await Promise.all(capUsers.map(u => post(u, 'stress cap ' + k))); rs.forEach((r, i) => capRes[i].push(r.ok ? 'ok' : r.e)); }
capUsers.forEach((u, i) => { const okN = capRes[i].filter(x => x === 'ok').length; log(`cap user ${i}: accepted ${okN} more (total ${already[i] + okN}), first reject:`, capRes[i].find(x => x !== 'ok')); });
log('counts', JSON.stringify(counts));
// 7) cleanup
let del = 0, delErr = 0, termsDel = 0;
for (const u of users) { const d = await u.sb.from('messages').delete().eq('user_id', u.id).select('id'); if (d.error) delErr++; else del += d.data.length;
  const t = await u.sb.from('terms_acceptances').delete().eq('user_id', u.id).select(); if (!t.error) termsDel += t.data.length; }
const left = await users[0].sb.from('messages').select('id', { count: 'exact', head: true }).eq('room', ROOM);
log('cleanup: messages deleted', del, 'errors', delErr, 'terms rows deleted', termsDel, 'visible left in room', left.count);
console.log('USER_IDS', JSON.stringify(users.map(u => u.id)));
for (const u of users) await u.sb.removeAllChannels(); process.exit(0);
