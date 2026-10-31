-- Loosen the server-side phone backstop: only phone-like numbers (10 digits, or 11 with a leading 1,
-- optionally separated), never digits that are part of a longer run. Safe to re-run.
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
  if new.body ~ '(^|[^0-9+])(\+?1[ .-]?)?\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}($|[^0-9])'
     or new.body ~* '\m\d{1,6}\s+(\w+\s){0,3}(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way|pl|place|cir|circle|ter|terrace|pkwy|hwy)\M'
     or new.body ~* '\m(kill|shoot|stab|murder|bomb|hurt|attack|dox+)\M.{0,30}\m(him|her|them|cop|cops|officer|officers|police|you)\M' then
    raise exception 'message blocked by content policy' using errcode = 'P0001';
  end if;
  return new;
end $$;
