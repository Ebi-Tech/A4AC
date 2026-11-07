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

npm run verify           # four check scripts (schema, auth, sentences, write); each ends "all checks passed"
                         # (the last two use the app on :3000 if running, otherwise start one on :3100;
                         #  the queue speed check loads 30,000 temporary sentences and only runs against
                         #  a local database unless you set VERIFY_PERF=1)
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
5. **Auth > Email Templates**: paste `supabase/templates/magic_link.html` into both "Magic Link" and "Confirm signup". This makes sign-in links work even when opened in a phone's mail app, and returns people to the page they were trying to reach. (Re-paste it whenever the file changes.)
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
9. `20261109000001_sentence_bank` topics, duplicate key, `seen_anchor_language_id`, protection of used sentences
10. `20261109000002_task_queue` coverage counters, `has_verified_french`, the two queue functions
11. `20261109000003_admin_tools` admin-only functions (language requests, anchors, usage, duplicate lookup)
12. `20261110000001_write_task` special characters, last language, settings, skips, reports, translation rules
13. `20261110000002_queue_v2` coverage row for every sentence/language, skips and permissions in the queue, benchmark

**Vote counting must only use non-stale reviews**: query the `review_votes` view, or filter `not is_stale`.

## Admins

```bash
npm run make-admin -- someone@example.com    # the person must have signed in once
```

Admin pages live under `/admin` (sentences, French anchors, language requests). Everyone else gets a 404 there;
the check runs in the middleware, in the admin layout, in every admin action and in the database.

## The sentence bank

English is the canonical anchor: every sentence is stored once, in English. A French version is a translation of
that sentence into `fra` and only counts as an anchor once verified (admins verify or add them on `/admin/anchors`).
Contributors see English if they understand it, otherwise the verified French version; contributions always point
at the same `sentence_id`, with `seen_anchor_language_id` recording which one they saw.

A sentence that has contributions cannot be deleted or reworded. Deactivate it instead (and add a corrected one).

### Importing sentences

```bash
npm run import-sentences -- sentences.txt --source "Volunteer list Nov 2026" --license "CC0-1.0"
npm run import-sentences -- sentences.csv --source "…" --license "…" --dry-run   # check only
```

- `.txt`: one sentence per line. `.csv` / `.tsv`: columns `text`, `topic`, `difficulty` (header row optional).
- Skipped and reported: duplicates (in the file or already in the bank, ignoring case and punctuation), fewer
  than 3 or more than 15 words, digits, web addresses, email addresses, all-caps abbreviations, and anything on
  the blocklist (`config/blocklist.txt`, empty by default; `--blocklist <file>` to use another).
- Quotes and whitespace are normalised; difficulty (1–5) is estimated from length when not given.
- `--license` is required. `--json` prints the summary as JSON.

The same validation runs for "Add a sentence" and "Bulk upload" on `/admin/sentences` (files up to 4 MB).

### Task queue

`next_sentence_for_write(language_id, exclude?)` and `next_sentence_for_speak(language_id, exclude?)` return the
next sentence for the signed-in user: in an open language they speak, one they can read, have not done or
skipped (within 7 days) in that language, and that has the fewest non-rejected translations / recordings there
(ties broken randomly). `sentence_coverage` keeps a row per sentence and language with trigger-maintained counts,
so each call is a short index walk: about 2 ms with 30,000 sentences and 3,000 skips.

## Contributing (WRITE task)

- `/contribute` lists the open languages the user speaks (native or fluent) and remembers the last one chosen on
  their profile. Speak, Transcribe and Review show as "coming soon".
- `/contribute/<iso>/write` shows the anchor sentence (English, or the verified French version), a text box with
  tap-to-insert letters (`languages.special_characters`, editable on `/admin/languages`), Submit and Skip. The next
  sentence is prefetched while typing; the draft is kept in browser storage.
- Skip asks why ("not sure", "unclear", "report"). Reports appear on `/admin/reports`.
- The database rejects, with a friendly message, translations that are empty, copied from the anchor, contain a
  URL, email or phone number, are far longer/shorter than the anchor, duplicate the user's own earlier
  translation, are in a language the user doesn't speak or that isn't open, or exceed the rate limit.
- Limits live in `app_settings` (`translation_min_ratio`, `translation_max_ratio`, `translation_rate_limit`,
  `translation_rate_window`, `skip_cooldown`); change them with SQL, no deploy needed.
- `/profile` lists "My translations": edit (sends it back for review) or delete while pending.

## Project layout

```
content/consent.md        consent text (editable, versioned)
config/blocklist.txt      words kept out of the sentence bank
src/app/                  pages: / /languages /login /onboarding /profile /contribute
src/app/admin/            admin pages and actions
src/lib/sentence-import.ts  parsing and validation shared by the import script and bulk upload
src/app/auth/             /auth/confirm (email link) and /auth/callback (Google)
src/app/actions/          server actions (sign-in/out, consent, name, languages, delete account)
src/components/           shared UI (language picker, forms)
src/lib/supabase/         clients: browser, server, admin (service role), middleware
src/lib/account-deletion.ts  deletes audio files, then the user (rows cascade)
src/middleware.ts         session refresh, sign-in and onboarding redirects
src/types/database.ts     generated by `npm run db:types`
supabase/templates/       sign-in email template
scripts/                  verify-*.ts checks, import-sentences.ts, make-admin.ts
```
