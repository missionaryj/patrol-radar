// Live smoke test for city chat: node scripts/chat-smoke.mjs <termsVersion>. Leaves only anonymous auth users + terms rows (no client delete policy).
import { createClient } from '@supabase/supabase-js';
const sb=createClient('https://vfqmoobjjsdeivhcgurx.supabase.co','sb_publishable_wQYhoGMbpsfV6KqJQr74Tg_-d_AF2jt');
const V=process.argv[2]; const room='US-IL-test-room';
const a=await sb.auth.signInAnonymously(); console.log('signin', a.error?.message??'ok', a.data.user?.id);
const t=await sb.from('terms_acceptances').insert({version:V}); console.log('terms', t.error?`${t.error.code} ${t.error.message}`:'ok');
let got=null; const ch=sb.channel('room:'+room).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`room=eq.${room}`},p=>{got=p.new});
await new Promise(r=>ch.subscribe(s=>{console.log('sub',s); if(s==='SUBSCRIBED')r()}));
const p1=await sb.from('messages').insert({room,body:'smoke test hello'}); console.log('post1', p1.error?`${p1.error.code} ${p1.error.message}`:'ok');
for(let i=0;i<50&&!got;i++) await new Promise(r=>setTimeout(r,200)); console.log('realtime', got?'received '+got.id:'NOT received');
const p2=await sb.from('messages').insert({room,body:'second'}); console.log('post2', p2.error?`rejected: ${p2.error.code} ${p2.error.message}`:'ACCEPTED (bad)');
const d=await sb.from('messages').delete().eq('room',room).select('id'); console.log('delete msgs', d.error?.message??`${d.data.length} deleted`);
const d2=await sb.from('terms_acceptances').delete().eq('version',V).select(); console.log('delete terms', d2.error?.message??`${d2.data.length} deleted`);
await sb.removeAllChannels(); process.exit(0);
