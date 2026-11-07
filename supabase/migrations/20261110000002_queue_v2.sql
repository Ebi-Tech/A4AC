-- =============================================================================
-- 13 · Task queue v2: skips, permissions, prefetch, steady speed
--
-- sentence_coverage now holds a row for EVERY (sentence, language) pair
-- (30,000 sentences x 7 languages = 210,000 small rows), plus copies of the
-- sentence's is_active, has_verified_french and random_key. Rows are created
-- by triggers when sentences or languages are added. With every pair present,
-- each queue step is a short walk along one index, with no counting:
--   1. walk (language, count, random_key) in count order to the first eligible
--      sentence: that is the lowest count available to this user;
--   2. pick a random sentence at that count by walking from a random point.
-- French-only readers walk separate partial indexes that contain only
-- sentences with a verified French version.
--
-- Eligible = active, readable, not already done by the user in that
-- language, not skipped by them there within app_settings.skip_cooldown, and
-- not in p_exclude (the app passes the sentence on screen so a prefetch never
-- returns it again). Nothing is returned unless the target language is open
-- and the user listed it as native or fluent.
--
-- next_sentence_for_write / next_sentence_for_speak gain an optional
-- p_exclude uuid[]. benchmark_next_sentence() (service role only) times the
-- queue inside the database for the verify script.
-- =============================================================================

alter table public.sentence_coverage add column has_verified_french boolean not null default false;

update public.sentence_coverage c
   set has_verified_french = s.has_verified_french, is_active = s.is_active
  from public.sentences s
 where s.id = c.sentence_id;

insert into public.sentence_coverage (sentence_id, language_id, is_active, has_verified_french, random_key)
select s.id, l.id, s.is_active, s.has_verified_french, s.random_key
from public.sentences s cross join public.languages l
on conflict (sentence_id, language_id) do nothing;

drop index public.sentence_coverage_write_idx;
drop index public.sentence_coverage_speak_idx;
create index sentence_coverage_write_idx    on public.sentence_coverage (language_id, translation_count, random_key) where is_active;
create index sentence_coverage_speak_idx    on public.sentence_coverage (language_id, recording_count, random_key) where is_active;
create index sentence_coverage_write_fr_idx on public.sentence_coverage (language_id, translation_count, random_key) where is_active and has_verified_french;
create index sentence_coverage_speak_fr_idx on public.sentence_coverage (language_id, recording_count, random_key) where is_active and has_verified_french;

/**
 * add_coverage_for_sentences
 * Statement trigger after sentences are inserted. Creates coverage rows for
 * every new sentence in every language.
 * Input: the transition table of inserted sentences. Output: null.
 */
create or replace function public.add_coverage_for_sentences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sentence_coverage (sentence_id, language_id, is_active, has_verified_french, random_key)
  select n.id, l.id, n.is_active, n.has_verified_french, n.random_key
  from new_sentences n cross join public.languages l
  on conflict (sentence_id, language_id) do nothing;
  return null;
end;
$$;

create trigger add_coverage_for_sentences after insert on public.sentences
  referencing new table as new_sentences
  for each statement execute function public.add_coverage_for_sentences();

/**
 * add_coverage_for_language
 * Trigger after a language is inserted. Creates its coverage rows for every
 * sentence.
 * Input: the new language row. Output: null.
 */
create or replace function public.add_coverage_for_language()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sentence_coverage (sentence_id, language_id, is_active, has_verified_french, random_key)
  select s.id, new.id, s.is_active, s.has_verified_french, s.random_key
  from public.sentences s
  on conflict (sentence_id, language_id) do nothing;
  return null;
end;
$$;

create trigger add_coverage_for_language after insert on public.languages
  for each row execute function public.add_coverage_for_language();

/**
 * sync_coverage_flags (replaces sync_coverage_active)
 * Trigger after a sentence's is_active or has_verified_french changes.
 * Copies both onto its coverage rows.
 * Input: OLD and NEW sentence rows. Output: null.
 */
create or replace function public.sync_coverage_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sentence_coverage
     set is_active = new.is_active, has_verified_french = new.has_verified_french
   where sentence_id = new.id;
  return null;
end;
$$;

drop trigger sync_coverage_active on public.sentences;
drop function public.sync_coverage_active();

create trigger sync_coverage_flags after update of is_active, has_verified_french on public.sentences
  for each row when (old.is_active is distinct from new.is_active or old.has_verified_french is distinct from new.has_verified_french)
  execute function public.sync_coverage_flags();

drop function public.next_sentence_for_write(uuid);
drop function public.next_sentence_for_speak(uuid);
drop function public.next_sentence(text, uuid);

/**
 * next_sentence
 * Shared implementation of the two queue functions (see header).
 * Input: p_task ('write' | 'speak'), p_language_id (target language),
 * p_exclude (sentence ids not to return, e.g. the one on screen).
 * Output: at most one row (sentence_id, anchor_text, anchor_language_id,
 * anchor_iso_code).
 */
create or replace function public.next_sentence(p_task text, p_language_id uuid, p_exclude uuid[] default '{}')
returns table (sentence_id uuid, anchor_text text, anchor_language_id uuid, anchor_iso_code text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user        uuid := auth.uid();
  v_column      text;
  v_done_table  text;
  v_eng         uuid;
  v_fra         uuid;
  v_filter      text;
  v_eligible    text;
  v_cutoff      timestamptz;
  v_r           double precision := random();
  v_min         integer;
  v_id          uuid;
begin
  if v_user is null or p_language_id is null then
    return;
  end if;

  v_column     := case p_task when 'write' then 'translation_count' when 'speak' then 'recording_count' end;
  v_done_table := case p_task when 'write' then 'translations'      when 'speak' then 'recordings' end;
  if v_column is null then
    raise exception 'unknown task %', p_task;
  end if;

  if not exists (
    select 1 from public.user_languages ul join public.languages l on l.id = ul.language_id
    where ul.user_id = v_user and ul.language_id = p_language_id
      and ul.ability in ('native', 'fluent') and l.status = 'open'
  ) then
    return;
  end if;

  select l.id into v_eng
  from public.user_languages ul join public.languages l on l.id = ul.language_id
  where ul.user_id = v_user and l.iso_code = 'eng' and (p_task = 'speak' or l.id <> p_language_id);

  select l.id into v_fra
  from public.user_languages ul join public.languages l on l.id = ul.language_id
  where ul.user_id = v_user and l.iso_code = 'fra' and (p_task = 'speak' or l.id <> p_language_id);

  if v_eng is null and v_fra is null then
    return;
  end if;

  select now() - skip_cooldown into v_cutoff from public.app_settings where id;

  v_filter := case when v_eng is not null then 'c.is_active' else 'c.is_active and c.has_verified_french' end;
  v_eligible := format(
    '%s
     and not (c.sentence_id = any($5))
     and not exists (select 1 from public.%I d where d.sentence_id = c.sentence_id and d.language_id = $1 and d.contributor_id = $2)
     and not exists (select 1 from public.sentence_skips k where k.user_id = $2 and k.language_id = $1
                     and k.sentence_id = c.sentence_id and k.created_at > $6)',
    v_filter, v_done_table
  );

  execute format(
    'select c.%1$I from public.sentence_coverage c
     where c.language_id = $1 and %2$s
     order by c.%1$I limit 1', v_column, v_eligible)
  into v_min using p_language_id, v_user, v_r, v_min, coalesce(p_exclude, '{}'), v_cutoff;

  if v_min is null then
    return;
  end if;

  execute format(
    'select c.sentence_id from public.sentence_coverage c
     where c.language_id = $1 and c.%1$I = $4 and c.random_key >= $3 and %2$s
     order by c.random_key limit 1', v_column, v_eligible)
  into v_id using p_language_id, v_user, v_r, v_min, coalesce(p_exclude, '{}'), v_cutoff;

  if v_id is null then
    execute format(
      'select c.sentence_id from public.sentence_coverage c
       where c.language_id = $1 and c.%1$I = $4 and c.random_key < $3 and %2$s
       order by c.random_key limit 1', v_column, v_eligible)
    into v_id using p_language_id, v_user, v_r, v_min, coalesce(p_exclude, '{}'), v_cutoff;
  end if;

  if v_id is null then
    return;
  end if;

  if v_eng is not null then
    return query
      select s.id, s.text, v_eng, 'eng'::text from public.sentences s where s.id = v_id;
  else
    return query
      select f.sentence_id, f.text, v_fra, 'fra'::text
      from public.translations f
      where f.sentence_id = v_id and f.language_id = v_fra and f.status = 'verified'
      order by f.updated_at desc
      limit 1;
  end if;
end;
$$;

/**
 * next_sentence_for_write
 * Next sentence for the WRITE task in the given language (see header).
 * Input: p_language_id, p_exclude (optional ids to leave out).
 * Output: sentence_id, anchor_text, anchor_language_id, anchor_iso_code.
 */
create or replace function public.next_sentence_for_write(p_language_id uuid, p_exclude uuid[] default '{}')
returns table (sentence_id uuid, anchor_text text, anchor_language_id uuid, anchor_iso_code text)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from public.next_sentence('write', p_language_id, p_exclude);
$$;

/**
 * next_sentence_for_speak
 * Next sentence for the SPEAK task in the given language (see header).
 * Input: p_language_id, p_exclude (optional ids to leave out).
 * Output: sentence_id, anchor_text, anchor_language_id, anchor_iso_code.
 */
create or replace function public.next_sentence_for_speak(p_language_id uuid, p_exclude uuid[] default '{}')
returns table (sentence_id uuid, anchor_text text, anchor_language_id uuid, anchor_iso_code text)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from public.next_sentence('speak', p_language_id, p_exclude);
$$;

/**
 * benchmark_next_sentence
 * Times the queue inside the database, acting as the given user. Used by the
 * verify script; service role only.
 * Input: p_user, p_language_id, p_task ('write' | 'speak'), p_runs.
 * Output: average milliseconds per call.
 */
create or replace function public.benchmark_next_sentence(p_user uuid, p_language_id uuid, p_task text, p_runs integer default 20)
returns numeric
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_started timestamptz;
  v_total   interval := '0';
  v_claims  text := current_setting('request.jwt.claims', true);
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role only' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform * from public.next_sentence(p_task, p_language_id);
  for i in 1 .. greatest(p_runs, 1) loop
    v_started := clock_timestamp();
    perform * from public.next_sentence(p_task, p_language_id);
    v_total := v_total + (clock_timestamp() - v_started);
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  return round((extract(epoch from v_total) * 1000 / greatest(p_runs, 1))::numeric, 2);
end;
$$;

revoke execute on function public.add_coverage_for_sentences()                from public, anon, authenticated;
revoke execute on function public.add_coverage_for_language()                 from public, anon, authenticated;
revoke execute on function public.sync_coverage_flags()                       from public, anon, authenticated;
revoke execute on function public.next_sentence(text, uuid, uuid[])           from public, anon, authenticated;
revoke execute on function public.next_sentence_for_write(uuid, uuid[])       from public, anon;
revoke execute on function public.next_sentence_for_speak(uuid, uuid[])       from public, anon;
revoke execute on function public.benchmark_next_sentence(uuid, uuid, text, integer) from public, anon, authenticated;
grant  execute on function public.next_sentence_for_write(uuid, uuid[])       to authenticated;
grant  execute on function public.next_sentence_for_speak(uuid, uuid[])       to authenticated;
grant  execute on function public.benchmark_next_sentence(uuid, uuid, text, integer) to service_role;
