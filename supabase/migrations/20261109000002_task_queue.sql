-- =============================================================================
-- 10 · Task queue
--
-- sentence_coverage   one row per (sentence, language) that has had a
--                     translation or recording, holding the number of
--                     non-rejected translations and recordings plus a copy of
--                     the sentence's is_active and random_key. Kept up to date
--                     by triggers, so the queue never counts contributions at
--                     request time. No row (or a zero count) = zero coverage.
-- sentences.has_verified_french
--                     true while the sentence has a verified French version.
--                     Maintained by a trigger on translations; lets French
--                     readers search only sentences they can actually read.
--
-- next_sentence_for_write(language_id)
-- next_sentence_for_speak(language_id)
--   Return one active sentence for the signed-in user that
--     * they can read: English if they understand English (and, for write,
--       English is not the target language), otherwise the verified French
--       version; sentences with neither are skipped,
--     * they have not already translated / recorded in that language,
--     * has the fewest non-rejected translations / recordings in that
--       language; ties are broken randomly.
--   Output: sentence_id, anchor_text, anchor_language_id, anchor_iso_code
--   (no row when nothing is available).
--
-- How it stays fast with tens of thousands of sentences:
--   1. An index-only count tells whether any readable active sentence still
--      has zero coverage. Only then is the zero-coverage pool searched, by
--      walking a random_key index from a random point and stopping at the
--      first eligible sentence.
--   2. Otherwise the coverage index is walked in count order to find the
--      lowest count among eligible sentences, and a random sentence at that
--      count is picked the same way.
--   French-only readers use partial indexes limited to sentences with a
--   verified French version.
-- =============================================================================

alter table public.sentences add column has_verified_french boolean not null default false;

update public.sentences s set has_verified_french = true
where exists (
  select 1 from public.translations t join public.languages l on l.id = t.language_id
  where t.sentence_id = s.id and l.iso_code = 'fra' and t.status = 'verified'
);

create index sentences_active_french_random_idx on public.sentences (random_key) where is_active and has_verified_french;

create table public.sentence_coverage (
  sentence_id        uuid not null references public.sentences (id) on delete cascade,
  language_id        uuid not null references public.languages (id) on delete cascade,
  translation_count  integer not null default 0 check (translation_count >= 0),
  recording_count    integer not null default 0 check (recording_count >= 0),
  is_active          boolean not null default true,
  random_key         double precision not null,
  primary key (sentence_id, language_id)
);
create index sentence_coverage_write_idx on public.sentence_coverage (language_id, translation_count, random_key)
  where translation_count > 0 and is_active;
create index sentence_coverage_speak_idx on public.sentence_coverage (language_id, recording_count, random_key)
  where recording_count > 0 and is_active;

insert into public.sentence_coverage (sentence_id, language_id, translation_count, recording_count, is_active, random_key)
select x.sentence_id, x.language_id, sum(x.t)::int, sum(x.r)::int, s.is_active, s.random_key
from (
  select sentence_id, language_id, 1 as t, 0 as r from public.translations where status <> 'rejected'
  union all
  select sentence_id, language_id, 0, 1 from public.recordings where status <> 'rejected'
) x
join public.sentences s on s.id = x.sentence_id
group by x.sentence_id, x.language_id, s.is_active, s.random_key;

alter table public.sentence_coverage enable row level security;
revoke all on public.sentence_coverage from anon, authenticated;
grant select on public.sentence_coverage to authenticated;
grant all on public.sentence_coverage to service_role;
create policy "sentence_coverage: admin read" on public.sentence_coverage
  for select to authenticated using ((select public.is_admin()));

/**
 * bump_coverage
 * Adds delta to one coverage counter, creating the row if needed.
 * Input: p_sentence, p_language, p_column ('translation_count' |
 * 'recording_count'), p_delta (+1 or -1). Output: none.
 */
create or replace function public.bump_coverage(p_sentence uuid, p_language uuid, p_column text, p_delta integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_column not in ('translation_count', 'recording_count') then
    raise exception 'unknown coverage column %', p_column;
  end if;
  execute format(
    'insert into public.sentence_coverage (sentence_id, language_id, %1$I, is_active, random_key)
     select $1, $2, greatest($3, 0), s.is_active, s.random_key from public.sentences s where s.id = $1
     on conflict (sentence_id, language_id)
     do update set %1$I = greatest(public.sentence_coverage.%1$I + $3, 0)',
    p_column
  ) using p_sentence, p_language, p_delta;
end;
$$;

/**
 * track_coverage
 * Trigger after insert, update or delete on translations and recordings.
 * Keeps sentence_coverage in step: a row counts while its status is not
 * 'rejected'.
 * Input: OLD/NEW rows; TG_ARGV[0] is the counter column. Output: null.
 */
create or replace function public.track_coverage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  counted_before boolean := tg_op in ('UPDATE', 'DELETE') and old.status <> 'rejected';
  counted_after  boolean := tg_op in ('INSERT', 'UPDATE') and new.status <> 'rejected';
begin
  if tg_op = 'UPDATE'
     and old.sentence_id = new.sentence_id
     and old.language_id = new.language_id
     and counted_before = counted_after then
    return null;
  end if;
  if counted_before then
    perform public.bump_coverage(old.sentence_id, old.language_id, tg_argv[0], -1);
  end if;
  if counted_after then
    perform public.bump_coverage(new.sentence_id, new.language_id, tg_argv[0], 1);
  end if;
  return null;
end;
$$;

create trigger track_coverage after insert or update or delete on public.translations
  for each row execute function public.track_coverage('translation_count');
create trigger track_coverage after insert or update or delete on public.recordings
  for each row execute function public.track_coverage('recording_count');

/**
 * sync_coverage_active
 * Trigger after a sentence's is_active changes. Copies the new value onto
 * its coverage rows.
 * Input: OLD and NEW sentence rows. Output: null.
 */
create or replace function public.sync_coverage_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sentence_coverage set is_active = new.is_active where sentence_id = new.id;
  return null;
end;
$$;

create trigger sync_coverage_active after update of is_active on public.sentences
  for each row when (old.is_active is distinct from new.is_active)
  execute function public.sync_coverage_active();

/**
 * track_verified_french
 * Trigger after insert, update or delete on translations. When a French
 * translation is involved, recomputes has_verified_french for its sentence.
 * Input: OLD/NEW rows. Output: null.
 */
create or replace function public.track_verified_french()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fra uuid;
  v_sentence uuid;
begin
  select id into v_fra from public.languages where iso_code = 'fra';
  foreach v_sentence in array array[
    case when tg_op <> 'INSERT' and old.language_id = v_fra then old.sentence_id end,
    case when tg_op <> 'DELETE' and new.language_id = v_fra then new.sentence_id end
  ] loop
    if v_sentence is not null then
      update public.sentences s
         set has_verified_french = exists (
           select 1 from public.translations t
           where t.sentence_id = v_sentence and t.language_id = v_fra and t.status = 'verified')
       where s.id = v_sentence
         and s.has_verified_french is distinct from exists (
           select 1 from public.translations t
           where t.sentence_id = v_sentence and t.language_id = v_fra and t.status = 'verified');
    end if;
  end loop;
  return null;
end;
$$;

create trigger track_verified_french after insert or update of status, language_id, sentence_id or delete on public.translations
  for each row execute function public.track_verified_french();

/**
 * next_sentence
 * Shared implementation of the two queue functions (see header).
 * Input: p_task ('write' | 'speak'), p_language_id (target language).
 * Output: at most one row (sentence_id, anchor_text, anchor_language_id,
 * anchor_iso_code).
 */
create or replace function public.next_sentence(p_task text, p_language_id uuid)
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
  v_readable    text;
  v_eligible    text;
  v_r           double precision := random();
  v_covered     bigint;
  v_active      bigint;
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

  select l.id into v_eng
  from public.user_languages ul join public.languages l on l.id = ul.language_id
  where ul.user_id = v_user and l.iso_code = 'eng' and (p_task = 'speak' or l.id <> p_language_id);

  select l.id into v_fra
  from public.user_languages ul join public.languages l on l.id = ul.language_id
  where ul.user_id = v_user and l.iso_code = 'fra' and (p_task = 'speak' or l.id <> p_language_id);

  if v_eng is null and v_fra is null then
    return;
  end if;

  v_readable := case when v_eng is not null then 's.is_active' else 's.is_active and s.has_verified_french' end;
  v_eligible := format(
    '%s and not exists (select 1 from public.%I d where d.sentence_id = s.id and d.language_id = $1 and d.contributor_id = $2)',
    v_readable, v_done_table
  );

  if v_eng is not null then
    execute format(
      'select count(*) from public.sentence_coverage c where c.language_id = $1 and c.%I > 0 and c.is_active', v_column)
    into v_covered using p_language_id;
  else
    execute format(
      'select count(*) from public.sentence_coverage c join public.sentences s on s.id = c.sentence_id
       where c.language_id = $1 and c.%I > 0 and c.is_active and %s', v_column, v_readable)
    into v_covered using p_language_id;
  end if;
  execute format('select count(*) from public.sentences s where %s', v_readable) into v_active;

  if v_covered < v_active then
    execute format(
      'select s.id from public.sentences s
       where s.random_key >= $3 and %s
         and not exists (select 1 from public.sentence_coverage c where c.sentence_id = s.id and c.language_id = $1 and c.%I > 0)
       order by s.random_key limit 1', v_eligible, v_column)
    into v_id using p_language_id, v_user, v_r;

    if v_id is null then
      execute format(
        'select s.id from public.sentences s
         where s.random_key < $3 and %s
           and not exists (select 1 from public.sentence_coverage c where c.sentence_id = s.id and c.language_id = $1 and c.%I > 0)
         order by s.random_key limit 1', v_eligible, v_column)
      into v_id using p_language_id, v_user, v_r;
    end if;
  end if;

  if v_id is null then
    execute format(
      'select c.%1$I from public.sentence_coverage c join public.sentences s on s.id = c.sentence_id
       where c.language_id = $1 and c.%1$I > 0 and c.is_active and %2$s
       order by c.%1$I limit 1', v_column, v_eligible)
    into v_min using p_language_id, v_user;

    if v_min is not null then
      execute format(
        'select c.sentence_id from public.sentence_coverage c join public.sentences s on s.id = c.sentence_id
         where c.language_id = $1 and c.%1$I = $4 and c.is_active and c.random_key >= $3 and %2$s
         order by c.random_key limit 1', v_column, v_eligible)
      into v_id using p_language_id, v_user, v_r, v_min;

      if v_id is null then
        execute format(
          'select c.sentence_id from public.sentence_coverage c join public.sentences s on s.id = c.sentence_id
           where c.language_id = $1 and c.%1$I = $4 and c.is_active and c.random_key < $3 and %2$s
           order by c.random_key limit 1', v_column, v_eligible)
        into v_id using p_language_id, v_user, v_r, v_min;
      end if;
    end if;
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
 * Input: p_language_id. Output: sentence_id, anchor_text, anchor_language_id, anchor_iso_code.
 */
create or replace function public.next_sentence_for_write(p_language_id uuid)
returns table (sentence_id uuid, anchor_text text, anchor_language_id uuid, anchor_iso_code text)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from public.next_sentence('write', p_language_id);
$$;

/**
 * next_sentence_for_speak
 * Next sentence for the SPEAK task in the given language (see header).
 * Input: p_language_id. Output: sentence_id, anchor_text, anchor_language_id, anchor_iso_code.
 */
create or replace function public.next_sentence_for_speak(p_language_id uuid)
returns table (sentence_id uuid, anchor_text text, anchor_language_id uuid, anchor_iso_code text)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from public.next_sentence('speak', p_language_id);
$$;

revoke execute on function public.bump_coverage(uuid, uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.track_coverage()                       from public, anon, authenticated;
revoke execute on function public.sync_coverage_active()                 from public, anon, authenticated;
revoke execute on function public.track_verified_french()                from public, anon, authenticated;
revoke execute on function public.next_sentence(text, uuid)              from public, anon, authenticated;
revoke execute on function public.next_sentence_for_write(uuid)          from public, anon;
revoke execute on function public.next_sentence_for_speak(uuid)          from public, anon;
grant  execute on function public.next_sentence_for_write(uuid)          to authenticated;
grant  execute on function public.next_sentence_for_speak(uuid)          to authenticated;
