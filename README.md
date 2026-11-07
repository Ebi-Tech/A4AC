# A4AC

An open web app where volunteers contribute translation and speech data for low-resource languages, starting with African languages. Every contribution hangs off a shared bank of anchor sentences, so the data is multi-way parallel.

Stack: Next.js (App Router, TypeScript, Tailwind) · Supabase (Postgres, Auth, Storage) · Vercel.

## Prerequisites

- Node.js 20+ and npm
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) (`brew install supabase/tap/supabase`)
- Docker Desktop, running (the local Supabase stack runs in containers)

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Start local Supabase. The first run downloads images and takes a few minutes.
#    Migrations in supabase/migrations and supabase/seed.sql are applied automatically.
supabase start

# 3. Create your env file and paste in the keys printed by `supabase status`
cp .env.example .env.local
supabase status          # copy API URL, anon key and service_role key

# 4. Check the schema, seed data and database rules
npm run verify

# 5. Run the app
npm run dev              # http://localhost:3000
```

Supabase Studio (table browser, SQL editor) runs at http://127.0.0.1:54323.

Local Supabase runs about a dozen Docker containers and can be heavy on a laptop. To keep it lighter:

- Start only what this app needs: `supabase start -x realtime,edge-runtime,logflare,vector,supavisor,imgproxy,mailpit`
- Run `supabase stop` (and quit Docker) when you're done.

### Without Docker (hosted Supabase project)

1. Create a free project at https://supabase.com/dashboard.
2. `supabase login && supabase link --project-ref <your-project-ref>`
3. `supabase db push` to apply the migrations, then paste `supabase/seed.sql` into the dashboard's SQL editor and run it.
4. Put the project URL, anon key and service_role key (Project Settings > API) in `.env.local`.
5. `npm run verify` then `npm run dev`. The verify script creates and deletes two throwaway users.

## Database workflow

| Task | Command |
| --- | --- |
| Rebuild the local DB from migrations and re-seed | `npm run db:reset` (`supabase db reset`) |
| Add a migration | `supabase migration new <name>`, then edit the file |
| Generate TypeScript types from the local DB | `mkdir -p src/types && npm run db:types` |
| Stop the local stack | `supabase stop` |

Migrations live in `supabase/migrations` and run in filename order:

1. `..._types_and_helpers.sql` enums and `set_updated_at()`
2. `..._tables.sql` all tables, indexes and `updated_at` triggers
3. `..._rules_and_triggers.sql` self-review block, edit rules, review history, profile creation
4. `..._row_level_security.sql` grants and RLS policies
5. `..._storage.sql` private `recordings` bucket and its policies

## Deploying to a hosted Supabase project

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push                 # applies migrations
psql "<connection string>" -f supabase/seed.sql   # optional: seed data
```

Then set the three variables from `.env.example` in Vercel (Project Settings > Environment Variables). `SUPABASE_SERVICE_ROLE_KEY` must not be exposed to the browser.

## Making someone an admin

Run this in Studio's SQL editor:

```sql
update public.profiles set role = 'admin' where id = '<user uuid>';
```

## Project layout

```
src/app/                 Next.js pages (placeholder home page for now)
src/lib/supabase/        client.ts (browser), server.ts (server, acts as user),
                         admin.ts (service role, signed audio URLs), middleware.ts
src/middleware.ts        refreshes the auth session on each request
supabase/migrations/     schema, rules, RLS, storage
supabase/seed.sql        languages and test sentences
scripts/verify-schema.ts end-to-end checks of schema and rules
```
