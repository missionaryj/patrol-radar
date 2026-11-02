-- 1.0.18: remove the 20/day new-account cap; keep 1 message per 10 s; raise the per-account daily ceiling 200 -> 1000.
-- Why keep a ceiling at all: the 10 s limit alone still lets one scripted anonymous account post 8,640 messages a day
-- into a city room (and anonymous sign-ups are free). 1,000/day is ~2.8 h of nonstop posting at the 10 s limit, far
-- beyond any human, so real users never see it; it only bounds a runaway script until a moderator bans it.
-- new_account_hours / new_account_daily_cap stay in chat_settings (unused) so older scripts don't break.
-- Safe to re-run. Apply in the Supabase SQL editor (project vfqmoobjjsdeivhcgurx).
update chat_settings set daily_cap = 1000, rate_limit_seconds = 10;
alter table chat_settings alter column daily_cap set default 1000;
comment on column chat_settings.new_account_daily_cap is 'unused since 20261102000000_remove_new_account_cap';

create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare s chat_settings; last_at timestamptz; n_today int;
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
  -- No new-account cap any more (removed 1.0.18). One soft per-account ceiling remains as abuse protection.
  select count(*) into n_today from messages where user_id = new.user_id and created_at > now() - interval '24 hours';
  if n_today >= s.daily_cap then raise exception 'daily limit reached' using errcode = 'P0001'; end if;

  -- backstop for the client filter: phone numbers, street addresses, threats
  if new.body ~ '(^|[^0-9+])(\+?1[ .-]?)?\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}($|[^0-9])'
     or new.body ~* '\m\d{1,6}\s+(\w+\s){0,3}(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way|pl|place|cir|circle|ter|terrace|pkwy|hwy)\M'
     or new.body ~* '\m(kill|shoot|stab|murder|bomb|hurt|attack|dox+)\M.{0,30}\m(him|her|them|cop|cops|officer|officers|police|you)\M' then
    raise exception 'message blocked by content policy' using errcode = 'P0001';
  end if;
  return new;
end $$;
