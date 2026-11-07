# A4AC

An open web app where volunteers contribute translation and speech data for low-resource languages, starting with African languages. Every contribution hangs off a shared bank of anchor sentences, so the data is multi-way parallel.

Stack: Next.js (App Router, TypeScript, Tailwind) · Supabase (Postgres, Auth, Storage) · Vercel.

## Prerequisites

- Node.js 20+ and npm
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) (`brew install supabase/tap/supabase`)
- Docker Desktop, running, for local Supabase only. Not needed if you use a hosted project (see below).

## Local setup

```bash
npm install

# Start only the Supabase services this app needs (lighter on your laptop).
# The first run downloads images and takes a few minutes.
# Migrations and supabase/seed.sql are applied automatically.
supabase start -x realtime,edge-runtime,logflare,vector,supavisor,imgproxy,studio,postgres-meta

# Create .env.local from the local keys
cp .env.example .env.local
supabase status -o env   # copy API_URL, ANON_KEY and SERVICE_ROLE_KEY into .env.local

npm run verify           # schema + auth/consent checks; prints "all checks passed" twice
npm run dev              # http://localhost:3000

supabase stop            # when you're done (then quit Docker)
```

**Sign-in emails locally** never leave your machine. Open Mailpit at http://127.0.0.1:54324 to click the link.
If the email says "Your Magic Link" (Supabase's default) instead of "Your A4AC sign-in link", the auth container
started before our template was available. Run `docker restart supabase_auth_a4ac` and try again.

Drop `studio` from the `-x` list if you want the Supabase table browser at http://127.0.0.1:54323.

## Using a hosted Supabase project (no Docker)

1. Create a project at https://supabase.com/dashboard.
2. `supabase login && supabase link --project-ref <your-project-ref>`
3. `supabase db push` applies the migrations. Then run `supabase/seed.sql` in the dashboard's SQL editor.
4. **Auth > URL Configuration**: set Site URL to your app URL, and add `http://localhost:3000/**` and your Vercel URL + `/**` to Redirect URLs.
5. **Auth > Email Templates**: paste `supabase/templates/magic_link.html` into both "Magic Link" and "Confirm signup". This makes sign-in links work even when opened in a phone's mail app.
6. Put the URL and keys (Project Settings > API) into `.env.local`, then `npm run verify` and `npm run dev`. The verify scripts create and delete throwaway test users.

## Google sign-in (optional)

The Google button only appears when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in the app's env.

- Hosted: enable Google under Auth > Providers with the same keys. The redirect URI to register with Google is shown there.
- Local: put the two variables in `supabase/.env`, set `enabled = true` under `[auth.external.google]` in `supabase/config.toml`, and restart Supabase.

## Consent

The consent text lives in `content/consent.md`. Its first line is `version: ...`. To change the text:

1. Edit the file and change the version (e.g. to today's date).
2. Add a migration: `update public.app_settings set current_consent_version = '<new version>';`

Every user is then asked to consent again before they can contribute. `npm run verify` fails if the two versions differ.

## Database workflow

| Task | Command |
| --- | --- |
| Rebuild the local DB from migrations and re-seed | `npm run db:reset` |
| Add a migration | `supabase migration new <name>` |
| Regenerate TypeScript types after a schema change | `npm run db:types` |
| Run all checks | `npm run verify`, `npm run typecheck`, `npm run lint` |

Migrations (`supabase/migrations`, applied in order):

1. `20261107000001_types_and_helpers` enums, `set_updated_at()`
2. `20261107000002_tables` all core tables and indexes
3. `20261107000003_rules_and_triggers` self-review block, edit rules, review history, profile creation
4. `20261107000004_row_level_security` grants and RLS policies
5. `20261107000005_storage` private `recordings` bucket and policies
6. `20261108000001_stale_reviews` text edits reset to pending and mark reviews stale; `review_votes` view
7. `20261108000002_consent_and_onboarding` `app_settings`, consent enforcement, `language_requests`, anonymous names
8. `20261108000003_stats` `language_stats()` and `my_contribution_counts()`

**Vote counting must only use non-stale reviews**: query the `review_votes` view, or filter `not is_stale`.

## Making someone an admin

```sql
update public.profiles set role = 'admin' where id = '<user uuid>';
```

## Project layout

```
content/consent.md        consent text (editable, versioned)
src/app/                  pages: / /languages /login /onboarding /profile /contribute
src/app/auth/             /auth/confirm (email link) and /auth/callback (Google)
src/app/actions/          server actions (sign-in/out, consent, name, languages, delete account)
src/components/           shared UI (language picker, forms)
src/lib/supabase/         clients: browser, server, admin (service role), middleware
src/lib/account-deletion.ts  deletes audio files, then the user (rows cascade)
src/middleware.ts         session refresh, sign-in and onboarding redirects
src/types/database.ts     generated by `npm run db:types`
supabase/templates/       sign-in email template
scripts/                  verify-schema.ts, verify-auth.ts
```
