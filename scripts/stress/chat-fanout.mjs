// Fan-out diagnostic: N subscribers, burst then paced posts, per-message delivery. Test room only.
import { createClient } from '@supabase/supabase-js';
const URL = 'https://vfqmoobjjsdeivhcgurx.supabase.co', KEY = 'sb_publishable_wQYhoGMbpsfV6KqJQr74Tg_-d_AF2jt', ROOM = 'US-ZZ-stresstest';
const N = +(process.argv[2] ?? 15); const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => { a = [...a].sort((x, y) => x - y); return Math.round(a[Math.floor((a.length - 1) * p)] ?? NaN); };
const users = [];
for (let i = 0; i < N; i++) { const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const a = await sb.auth.signInAnonymously(); if (a.error) { console.log('signin', a.error.message); break; }
  await sb.from('terms_acceptances').insert({ version: 1 }); users.push({ sb, id: a.data.user.id, recv: new Map() }); }
await Promise.all(users.map(u => new Promise(res => { u.sb.channel('room:' + ROOM).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room=eq.${ROOM}` }, p => u.recv.set(p.new.id, performance.now())).subscribe(s => s === 'SUBSCRIBED' && res()); })));
await sleep(2000);
const sent = [];
const post = async (u, body, phase) => { const t = performance.now(); const r = await u.sb.from('messages').insert({ room: ROOM, body }).select('id').single(); if (!r.error) sent.push({ id: r.data.id, t, phase }); };
// paced: one post every 700 ms from successive users
for (const [i, u] of users.entries()) { await post(u, 'stress paced ' + i, 'paced'); await sleep(700); }
await sleep(11000);
await Promise.all(users.map((u, i) => post(u, 'stress burst ' + i, 'burst')));
await sleep(6000);
for (const phase of ['paced', 'burst']) { const lat = []; let miss = 0; const perMsg = [];
  for (const s of sent.filter(x => x.phase === phase)) { let got = 0; for (const u of users) { const r = u.recv.get(s.id); if (r === undefined) miss++; else { got++; lat.push(r - s.t); } } perMsg.push(got); }
  console.log(phase, 'msgs', perMsg.length, 'expected', perMsg.length * users.length, 'delivered', lat.length, 'missing', miss, 'per-msg receivers min/max', Math.min(...perMsg), Math.max(...perMsg), 'latency p50/p95/max ms', pct(lat, .5), pct(lat, .95), Math.round(Math.max(...lat))); }
console.log('per-user received', users.map(u => u.recv.size).join(','));
let del = 0; for (const u of users) { const d = await u.sb.from('messages').delete().eq('user_id', u.id).select('id'); del += d.data?.length ?? 0; }
console.log('deleted', del, 'USER_IDS', JSON.stringify(users.map(u => u.id))); process.exit(0);
