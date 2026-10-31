# City chat: Supabase setup

Everything in the app is ready; chat shows "Chat not configured" until these steps are done. About 15 minutes. Free plan is fine to start (200 concurrent realtime connections, 2M realtime messages/month; Pro is $25/mo).

## 1. Account and project (needs you, or Grok Bot in its browser with your OK)
1. Go to https://supabase.com/dashboard and sign up (GitHub login with `missionaryj` is easiest). Confirm the email if asked.
2. **New project** → organization: personal, **Name** `patrol-radar`, **Database password**: generate one and save it in your password manager (not needed by the app), **Region**: `East US (Ohio)` / `us-east-2` (closest to Illinois), **Plan**: Free. Create and wait ~2 minutes.

## 2. Turn on what chat needs
3. **Authentication → Sign In / Providers → Anonymous sign-ins**: turn **on**, Save. (Leave email/phone providers as they are; chat never asks for them.)
4. Optional but recommended: **Authentication → Attack Protection**: enable **CAPTCHA** (Cloudflare Turnstile) later if spam shows up.
5. **Database → Extensions**: search `pg_cron` and **enable** it (schema `pg_catalog`/default).

## 3. Create the tables, rules and jobs
6. **SQL Editor → New query**, paste all of `supabase/migrations/20261030000000_city_chat.sql`, **Run**. It should finish with "Success". (It is safe to run again.)
   - Or with the CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
7. Check: **Database → Tables** shows `messages, reports, blocks, bans, terms_acceptances, chat_settings`, each with RLS **enabled**. **Database → Publications → supabase_realtime** includes `messages`. **Integrations → Cron** shows `patrol-radar-purge-chat` every 10 minutes.

## 4. Connect the app
8. **Project Settings → API** (or **Connect**): copy the **Project URL** and the **anon / publishable** key. Both are public by design; never use the `service_role` / secret key in the app.
9. Local: copy `.env.example` to `.env.local` and fill them in. Pages deploy: add them as GitHub Actions secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (repo → Settings → Secrets and variables → Actions) and pass them as `env:` to the `npm run build` step. Android: build with the same `.env.local` present, then `npx cap sync android` and a new AAB.
10. **Authentication → URL Configuration**: Site URL `https://missionaryj.github.io/patrol-radar/` (anonymous sign-in doesn't redirect, but set it anyway).

## 5. Moderating (SQL Editor; the `moderation` schema isn't reachable from the app)
```sql
select * from moderation.report_queue;                 -- open reports, most-reported first
select moderation.delete_message(123);                 -- delete a post and close its reports
select moderation.dismiss(123);                        -- reports were wrong: unhide and close
select moderation.ban('USER-UUID', 'threats');         -- permanent ban, deletes their posts
select moderation.ban('USER-UUID', 'spam', 7);         -- 7-day ban
select moderation.unban('USER-UUID');
select * from moderation.user_reports;                 -- repeat offenders
update chat_settings set hide_after_reports = 2;       -- tune limits (also rate_limit_seconds, new_account_daily_cap, daily_cap, retention_hours)
```
Google Play requires acting on reports in a timely way: check the queue at least daily once chat is live.

## 6. Before publishing
- Update the Play Console **Data safety** form: the app now collects "Messages: other in-app messages" (user-generated, can be deleted, retained 24 h / 7 days if reported) and an anonymous account ID. Encrypted in transit: yes.
- Update `public/privacy` with the chat section.
- Test with 2 phones: post, report from 3 accounts (auto-hide), block, ban.
- City list: GeoNames cities1000 (CC BY 4.0), https://www.geonames.org/ — public/data/cities/us.json
