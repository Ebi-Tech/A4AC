-- =============================================================================
-- 04 · Row Level Security
--
-- RLS is on for every table. Anonymous visitors get no table access at all.
-- Signed-in users:
--   languages, sentences  read all; only admins write
--   profiles              read/update own row (guard trigger blocks role and
--                         trust_score); admins read/update all
--   user_languages        full control of own rows
--   translations,         read everything that is not rejected (plus own rows);
--   recordings,           insert own; update own while not rejected (the
--   transcripts           triggers in 03 limit what may change); recordings
--                         have no contributor update, only delete-own-pending
--   reviews               read/insert/update own; reviewers do not see other
--                         people's votes, so agreement stays independent
--   review_history        read own; no direct writes for anyone (the trigger
--                         in 03 writes as the table owner)
--   flags                 read/insert own; only admins change status
--   gold_samples          admins only, so reviewers cannot tell which items
--                         are tests
-- Admins can read and change everything (except writing review_history).
-- The service_role key bypasses RLS, as always in Supabase.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke insert, update, delete on public.review_history from authenticated;

alter table public.profiles       enable row level security;
alter table public.languages      enable row level security;
alter table public.user_languages enable row level security;
alter table public.sentences      enable row level security;
alter table public.translations   enable row level security;
alter table public.recordings     enable row level security;
alter table public.transcripts    enable row level security;
alter table public.reviews        enable row level security;
alter table public.review_history enable row level security;
alter table public.flags          enable row level security;
alter table public.gold_samples   enable row level security;

-- profiles
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: update own or admin" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- languages
create policy "languages: signed-in read" on public.languages
  for select to authenticated using (true);
create policy "languages: admin insert" on public.languages
  for insert to authenticated with check ((select public.is_admin()));
create policy "languages: admin update" on public.languages
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "languages: admin delete" on public.languages
  for delete to authenticated using ((select public.is_admin()));

-- sentences
create policy "sentences: signed-in read" on public.sentences
  for select to authenticated using (true);
create policy "sentences: admin insert" on public.sentences
  for insert to authenticated with check ((select public.is_admin()));
create policy "sentences: admin update" on public.sentences
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "sentences: admin delete" on public.sentences
  for delete to authenticated using ((select public.is_admin()));

-- user_languages
create policy "user_languages: read own or admin" on public.user_languages
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "user_languages: insert own" on public.user_languages
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "user_languages: update own" on public.user_languages
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "user_languages: delete own or admin" on public.user_languages
  for delete to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- translations
create policy "translations: read non-rejected, own, or admin" on public.translations
  for select to authenticated
  using (status <> 'rejected' or contributor_id = (select auth.uid()) or (select public.is_admin()));
create policy "translations: insert own" on public.translations
  for insert to authenticated with check (contributor_id = (select auth.uid()));
create policy "translations: update own editable or admin" on public.translations
  for update to authenticated
  using ((contributor_id = (select auth.uid()) and status <> 'rejected') or (select public.is_admin()))
  with check (contributor_id = (select auth.uid()) or (select public.is_admin()));
create policy "translations: admin delete" on public.translations
  for delete to authenticated using ((select public.is_admin()));

-- recordings
create policy "recordings: read non-rejected, own, or admin" on public.recordings
  for select to authenticated
  using (status <> 'rejected' or contributor_id = (select auth.uid()) or (select public.is_admin()));
create policy "recordings: insert own" on public.recordings
  for insert to authenticated with check (contributor_id = (select auth.uid()));
create policy "recordings: admin update" on public.recordings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "recordings: delete own pending or admin" on public.recordings
  for delete to authenticated
  using ((contributor_id = (select auth.uid()) and status = 'pending') or (select public.is_admin()));

-- transcripts
create policy "transcripts: read non-rejected, own, or admin" on public.transcripts
  for select to authenticated
  using (status <> 'rejected' or contributor_id = (select auth.uid()) or (select public.is_admin()));
create policy "transcripts: insert own" on public.transcripts
  for insert to authenticated with check (contributor_id = (select auth.uid()));
create policy "transcripts: update own editable or admin" on public.transcripts
  for update to authenticated
  using ((contributor_id = (select auth.uid()) and status <> 'rejected') or (select public.is_admin()))
  with check (contributor_id = (select auth.uid()) or (select public.is_admin()));
create policy "transcripts: admin delete" on public.transcripts
  for delete to authenticated using ((select public.is_admin()));

-- reviews
create policy "reviews: read own or admin" on public.reviews
  for select to authenticated using (reviewer_id = (select auth.uid()) or (select public.is_admin()));
create policy "reviews: insert own" on public.reviews
  for insert to authenticated with check (reviewer_id = (select auth.uid()));
create policy "reviews: update own" on public.reviews
  for update to authenticated
  using (reviewer_id = (select auth.uid()) or (select public.is_admin()))
  with check (reviewer_id = (select auth.uid()) or (select public.is_admin()));
create policy "reviews: admin delete" on public.reviews
  for delete to authenticated using ((select public.is_admin()));

-- review_history (read only; rows come from the log_review_change trigger)
create policy "review_history: read own or admin" on public.review_history
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.reviews r
      where r.id = review_history.review_id and r.reviewer_id = (select auth.uid())
    )
  );

-- flags
create policy "flags: read own or admin" on public.flags
  for select to authenticated using (flagger_id = (select auth.uid()) or (select public.is_admin()));
create policy "flags: insert own" on public.flags
  for insert to authenticated with check (flagger_id = (select auth.uid()));
create policy "flags: admin update" on public.flags
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "flags: admin delete" on public.flags
  for delete to authenticated using ((select public.is_admin()));

-- gold_samples
create policy "gold_samples: admin only" on public.gold_samples
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
