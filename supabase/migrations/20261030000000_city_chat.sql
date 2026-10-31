-- patrol-radar city chat. Run once in the Supabase SQL editor (or `supabase db push`).
-- Privacy: rooms are city keys (e.g. 'US-IL-champaign') computed ON DEVICE from a coarse grid cell.
-- No coordinates, device IDs, MACs or Wi-Fi names are ever stored here. Users are Supabase anonymous users.

create extension if not exists pg_cron;

-- ---------- settings ----------
create table if not exists public.chat_settings (
  id boolean primary key default true check (id),
  terms_version int not null default 1,
  hide_after_reports int not null default 3,      -- auto-hide after N distinct reports
  rate_limit_seconds int not null default 30,      -- 1 message per 30 s
  new_account_hours int not null default 24,       -- "new account" window
  new_account_daily_cap int not null default 20,
  daily_cap int not null default 200,
  retention_hours int not null default 24,         -- normal messages deleted after 24 h
  reported_retention_days int not null default 7   -- reported messages kept for review, then deleted
);
insert into public.chat_settings default values on conflict do nothing;

-- ---------- tables ----------
create table if not exists public.terms_acceptances (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  version int not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  room text not null check (room ~ '^[A-Z]{2}-[A-Z0-9]{1,3}-[a-z0-9-]{1,60}$'),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  display_name text not null default '',
  body text not null check (char_length(btrim(body)) between 1 and 280),
  created_at timestamptz not null default now(),
  report_count int not null default 0,
  hidden boolean not null default false
);
create index if not exists messages_room_time on public.messages (room, created_at desc);
create index if not exists messages_user_time on public.messages (user_id, created_at desc);

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  message_id bigint references public.messages on delete set null,
  reported_user uuid not null,
  reporter uuid not null references auth.users on delete cascade default auth.uid(),
  kind text not null check (kind in ('message','user')),
  reason text check (char_length(reason) <= 200),
  body_snapshot text,             -- copy of the text so moderators can review after deletion
  room text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (message_id, reporter, kind)
);

create table if not exists public.blocks (
  blocker uuid not null references auth.users on delete cascade default auth.uid(),
  blocked uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

create table if not exists public.bans (
  user_id uuid primary key,
  reason text,
  until timestamptz,               -- null = permanent
  created_at timestamptz not null default now()
);

-- ---------- helpers ----------
create or replace function public.is_banned(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bans where user_id = uid and (until is null or until > now()));
$$;

create or replace function public.has_current_terms(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from terms_acceptances t, chat_settings s where t.user_id = uid and t.version = s.terms_version);
$$;

-- Random display name, stable per user per UTC day, generated server-side (no impersonation).
create or replace function public.daily_handle(uid uuid) returns text
language sql stable as $$
  select (array['Amber','Teal','Slate','Coral','Olive','Indigo','Rust','Sage','Ivory','Cobalt','Maroon','Jade','Copper','Plum','Ash','Mint'])
           [1 + abs(hashtext(uid::text || current_date::text)) % 16]
      || ' ' ||
         (array['Fox','Owl','Heron','Otter','Hawk','Lynx','Wren','Bison','Crane','Moose','Finch','Badger','Raven','Elk','Hare','Pike'])
           [1 + abs(hashtext(current_date::text || uid::text)) % 16];
$$;

-- Insert guard: identity, bans, terms, rate limit, daily caps, light server-side content filter.
create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare s chat_settings; last_at timestamptz; n_today int; acct_created timestamptz;
begin
  select * into s from chat_settings;
  new.user_id := auth.uid();
  if new.user_id is null then raise exception 'not signed in'; end if;
  if is_banned(new.user_id) then raise exception 'banned' using errcode = 'P0001'; end if;
  if not has_current_terms(new.user_id) then raise exception 'terms not accepted' using errcode = 'P0001'; end if;
  new.display_name := daily_handle(new.user_id);
  new.created_at := now(); new.report_count := 0; new.hidden := false;
  new.body := btrim(new.body);

  select max(created_at) into last_at from messages where user_id = new.user_id;
  if last_at is not null and last_at > now() - make_interval(secs => s.rate_limit_seconds) then
    raise exception 'rate limited: 1 message per % s', s.rate_limit_seconds using errcode = 'P0001';
  end if;
  select created_at into acct_created from auth.users where id = new.user_id;
  select count(*) into n_today from messages where user_id = new.user_id and created_at > now() - interval '24 hours';
  if acct_created > now() - make_interval(hours => s.new_account_hours) and n_today >= s.new_account_daily_cap then
    raise exception 'daily limit for new accounts reached' using errcode = 'P0001';
  end if;
  if n_today >= s.daily_cap then raise exception 'daily limit reached' using errcode = 'P0001'; end if;

  -- backstop for the client filter: phone numbers, street addresses, threats
  if new.body ~* '(\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}'
     or new.body ~* '\m\d{1,6}\s+(\w+\s){0,3}(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way|pl|place|cir|circle|ter|terrace|pkwy|hwy)\M'
     or new.body ~* '\m(kill|shoot|stab|murder|bomb|hurt|attack|dox+)\M.{0,30}\m(him|her|them|cop|cops|officer|officers|police|you)\M' then
    raise exception 'message blocked by content policy' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

-- Reports: fill snapshot, count distinct reporters, auto-hide at threshold.
create or replace function public.reports_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare m messages;
begin
  new.reporter := auth.uid(); new.created_at := now(); new.resolved_at := null;
  if new.message_id is not null then
    select * into m from messages where id = new.message_id;
    if not found then raise exception 'message not found'; end if;
    new.reported_user := m.user_id; new.body_snapshot := m.body; new.room := m.room;
  end if;
  if new.reported_user = new.reporter then raise exception 'cannot report yourself'; end if;
  return new;
end $$;
drop trigger if exists reports_before_insert on public.reports;
create trigger reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

create or replace function public.reports_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; s chat_settings;
begin
  if new.message_id is null then return new; end if;
  select * into s from chat_settings;
  select count(distinct reporter) into n from reports where message_id = new.message_id;
  update messages set report_count = n, hidden = hidden or n >= s.hide_after_reports where id = new.message_id;
  return new;
end $$;
drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert after insert on public.reports
  for each row execute function public.reports_after_insert();

-- ---------- row-level security ----------
alter table public.chat_settings      enable row level security;
alter table public.terms_acceptances  enable row level security;
alter table public.messages           enable row level security;
alter table public.reports            enable row level security;
alter table public.blocks             enable row level security;
alter table public.bans               enable row level security;

drop policy if exists settings_read on public.chat_settings;
create policy settings_read on public.chat_settings for select to authenticated using (true);

drop policy if exists terms_own_read on public.terms_acceptances;
create policy terms_own_read on public.terms_acceptances for select to authenticated using (user_id = auth.uid());
drop policy if exists terms_own_insert on public.terms_acceptances;
create policy terms_own_insert on public.terms_acceptances for insert to authenticated with check (user_id = auth.uid());

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (
  not hidden
  and created_at > now() - interval '24 hours'
  and not exists (select 1 from blocks b where b.blocker = auth.uid() and b.blocked = messages.user_id)
);
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned(auth.uid()) and public.has_current_terms(auth.uid()));
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete to authenticated using (user_id = auth.uid());
-- no update policy: messages can't be edited by clients

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (reporter = auth.uid());
-- no select policy on reports: reporters can't read the queue

drop policy if exists blocks_own_read on public.blocks;
create policy blocks_own_read on public.blocks for select to authenticated using (blocker = auth.uid());
drop policy if exists blocks_own_insert on public.blocks;
create policy blocks_own_insert on public.blocks for insert to authenticated with check (blocker = auth.uid());
drop policy if exists blocks_own_delete on public.blocks;
create policy blocks_own_delete on public.blocks for delete to authenticated using (blocker = auth.uid());

drop policy if exists bans_self on public.bans;
create policy bans_self on public.bans for select to authenticated using (user_id = auth.uid());

revoke update on public.messages from anon, authenticated;
revoke all on public.chat_settings from anon; grant select on public.chat_settings to authenticated;

-- ---------- realtime ----------
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- ---------- retention (pg_cron) ----------
create or replace function public.purge_chat() returns void
language sql security definer set search_path = public as $$
  delete from messages m using chat_settings s
   where (m.report_count = 0 and m.created_at < now() - make_interval(hours => s.retention_hours))
      or (m.created_at < now() - make_interval(days => s.reported_retention_days));
  delete from reports r using chat_settings s where r.created_at < now() - make_interval(days => s.reported_retention_days) * 4;
  delete from bans where until is not null and until < now();
$$;
select cron.unschedule('patrol-radar-purge-chat') where exists (select 1 from cron.job where jobname = 'patrol-radar-purge-chat');
select cron.schedule('patrol-radar-purge-chat', '*/10 * * * *', $$select public.purge_chat()$$);

-- ---------- moderation (dashboard SQL editor only; schema not exposed to the API) ----------
create schema if not exists moderation;
revoke all on schema moderation from public, anon, authenticated;

create or replace view moderation.report_queue as
  select r.message_id, r.room, r.reported_user,
         min(r.body_snapshot) as body, count(distinct r.reporter) as reporters,
         array_agg(distinct r.reason) filter (where r.reason is not null) as reasons,
         bool_or(m.hidden) as hidden_now, min(r.created_at) as first_report, max(r.created_at) as last_report,
         public.is_banned(r.reported_user) as banned
    from public.reports r left join public.messages m on m.id = r.message_id
   where r.resolved_at is null
   group by r.message_id, r.room, r.reported_user
   order by reporters desc, last_report desc;

create or replace view moderation.user_reports as
  select reported_user, count(*) as reports, count(distinct reporter) as reporters, max(created_at) as last_report,
         public.is_banned(reported_user) as banned
    from public.reports group by reported_user order by reporters desc;

create or replace function moderation.delete_message(mid bigint) returns void language sql as $$
  update public.reports set resolved_at = now() where message_id = mid and resolved_at is null;
  delete from public.messages where id = mid;
$$;
create or replace function moderation.dismiss(mid bigint) returns void language sql as $$
  update public.reports set resolved_at = now() where message_id = mid and resolved_at is null;
  update public.messages set hidden = false where id = mid;
$$;
create or replace function moderation.ban(uid uuid, why text default null, days int default null) returns void language sql as $$
  insert into public.bans (user_id, reason, until) values (uid, why, case when days is null then null else now() + make_interval(days => days) end)
  on conflict (user_id) do update set reason = excluded.reason, until = excluded.until, created_at = now();
  delete from public.messages where user_id = uid;
  update public.reports set resolved_at = now() where reported_user = uid and resolved_at is null;
$$;
create or replace function moderation.unban(uid uuid) returns void language sql as $$
  delete from public.bans where user_id = uid;
$$;
