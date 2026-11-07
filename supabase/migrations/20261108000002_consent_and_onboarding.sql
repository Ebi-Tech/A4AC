-- =============================================================================
-- 07 · Consent, onboarding and language requests
--
-- app_settings      single-row table holding current_consent_version. It must
--                   match the "version:" line at the top of content/consent.md;
--                   when the consent text changes, bump both and every user is
--                   asked to consent again.
-- profiles          + consent_version (version the user agreed to)
--                   + onboarded_at (set when onboarding is finished)
--                   Users can no longer write consent fields directly; they go
--                   through accept_consent(), which stamps the server time.
--                   Display names default to "Contributor 1234" and may not
--                   contain an email address.
-- language_requests users ask for a language that is missing; status starts
--                   as pending, only admins change it.
--
-- Consent is enforced by the require_consent trigger: no inserts into
-- translations, recordings, transcripts, reviews or flags unless the user
-- has accepted the current consent version and confirmed they are 18+.
-- The service role and owner-run code are exempt (seeding, maintenance).
--
-- New tables in public are no longer granted to anon by default.
-- =============================================================================

alter default privileges in schema public revoke all on tables from anon;

create table public.app_settings (
  id                       boolean primary key default true check (id),
  current_consent_version  text not null check (char_length(btrim(current_consent_version)) > 0),
  updated_at               timestamptz not null default now()
);

insert into public.app_settings (current_consent_version) values ('2026-11-08');

create trigger set_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.profiles
  add column consent_version text,
  add column onboarded_at    timestamptz;

update public.profiles
   set display_name = 'Contributor ' || (1000 + floor(random() * 9000))::int
 where display_name is null;

alter table public.profiles
  alter column display_name set not null,
  add constraint profiles_display_name_no_email
    check (display_name !~ '[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+');

drop trigger guard_columns on public.profiles;
create trigger guard_columns before update on public.profiles
  for each row execute function public.guard_columns('display_name', 'onboarded_at');

create type public.language_request_status as enum ('pending', 'added', 'declined');

create table public.language_requests (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 100),
  iso_code      text check (iso_code is null or iso_code ~ '^[a-z]{3}$'),
  note          text check (note is null or char_length(note) <= 1000),
  status        public.language_request_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index language_requests_requester_idx on public.language_requests (requester_id);
create index language_requests_pending_idx   on public.language_requests (created_at) where status = 'pending';

create trigger set_updated_at before update on public.language_requests
  for each row execute function public.set_updated_at();
create trigger force_initial_status before insert on public.language_requests
  for each row execute function public.force_initial_status('pending');

/**
 * handle_new_user (replaces the prompt-1 version)
 * Trigger on auth.users. Creates the profiles row for a new sign-up with an
 * anonymous display name such as "Contributor 4821". Names from Google or the
 * email address are never copied in.
 * Input: the new auth.users row. Output: the same row, unchanged.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, 'Contributor ' || (1000 + floor(random() * 9000))::int);
  return new;
end;
$$;

/**
 * current_consent_version
 * Returns the consent version users must have accepted.
 * Input: none. Output: text.
 */
create or replace function public.current_consent_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select current_consent_version from public.app_settings where id;
$$;

/**
 * has_valid_consent
 * Tells whether a user has accepted the current consent version and confirmed
 * they are 18 or older.
 * Input: p_user (uuid, defaults to the signed-in user). Output: boolean.
 */
create or replace function public.has_valid_consent(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user
      and p.consent_accepted_at is not null
      and p.is_adult_confirmed
      and p.consent_version = public.current_consent_version()
  );
$$;

/**
 * accept_consent
 * Records that the signed-in user accepted the consent text and confirmed
 * they are 18 or older. Fails if the version shown to them is not the
 * current one (the text changed while they were reading).
 * Input: p_version (version shown), p_is_adult (the 18+ checkbox).
 * Output: none.
 */
create or replace function public.accept_consent(p_version text, p_is_adult boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in' using errcode = 'insufficient_privilege';
  end if;
  if not coalesce(p_is_adult, false) then
    raise exception 'You must be 18 or older to contribute' using errcode = 'check_violation';
  end if;
  if p_version is distinct from public.current_consent_version() then
    raise exception 'The consent text has changed. Please reload the page and read it again'
      using errcode = 'check_violation';
  end if;

  update public.profiles
     set consent_accepted_at = now(),
         is_adult_confirmed = true,
         consent_version = p_version
   where id = auth.uid();
end;
$$;

/**
 * onboarding_status
 * Tells the app where the signed-in user is in onboarding.
 * Input: none. Output: 'signed_out', 'consent' (must accept the current
 * consent), 'profile' (name and languages not finished) or 'done'.
 */
create or replace function public.onboarding_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then 'signed_out'
    when not public.has_valid_consent(auth.uid()) then 'consent'
    when (select onboarded_at from public.profiles where id = auth.uid()) is null then 'profile'
    else 'done'
  end;
$$;

/**
 * require_consent
 * Trigger before insert on contribution, review and flag tables. Blocks the
 * insert unless the signed-in user has valid consent. The service role and
 * owner-run code are exempt.
 * Input: the new row. Output: the row unchanged, or an exception.
 */
create or replace function public.require_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if not public.has_valid_consent(auth.uid()) then
    raise exception 'Please accept the current consent terms before contributing'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger require_consent before insert on public.translations for each row execute function public.require_consent();
create trigger require_consent before insert on public.recordings   for each row execute function public.require_consent();
create trigger require_consent before insert on public.transcripts  for each row execute function public.require_consent();
create trigger require_consent before insert on public.reviews      for each row execute function public.require_consent();
create trigger require_consent before insert on public.flags        for each row execute function public.require_consent();

revoke execute on function public.accept_consent(text, boolean) from public, anon;
revoke execute on function public.has_valid_consent(uuid)        from public, anon;
grant  execute on function public.accept_consent(text, boolean)  to authenticated;
grant  execute on function public.has_valid_consent(uuid)        to authenticated;

revoke all on public.app_settings      from anon, authenticated;
revoke all on public.language_requests from anon, authenticated;
grant select                           on public.app_settings      to anon, authenticated;
grant update                           on public.app_settings      to authenticated;
grant select, insert, update, delete   on public.language_requests to authenticated;
grant all on public.app_settings, public.language_requests to service_role;

alter table public.app_settings      enable row level security;
alter table public.language_requests enable row level security;

create policy "app_settings: anyone reads" on public.app_settings
  for select to anon, authenticated using (true);
create policy "app_settings: admin update" on public.app_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "language_requests: read own or admin" on public.language_requests
  for select to authenticated using (requester_id = (select auth.uid()) or (select public.is_admin()));
create policy "language_requests: insert own" on public.language_requests
  for insert to authenticated with check (requester_id = (select auth.uid()));
create policy "language_requests: admin update" on public.language_requests
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "language_requests: admin delete" on public.language_requests
  for delete to authenticated using ((select public.is_admin()));
