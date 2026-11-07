-- =============================================================================
-- 15 · Read-aloud queue
--
-- read_aloud_pool   one row per translation that may be read aloud (status
--                   verified or unverified), with tier (0 verified,
--                   1 unverified), the number of non-rejected read-aloud
--                   recordings of it, a copy of its sentence's is_active and a
--                   random key. Kept in step by triggers on translations,
--                   recordings and sentences. Kept apart from translations so
--                   recording counts never touch translations.updated_at.
--
-- next_translation_for_read_aloud(language_id, exclude?)
--   One translation for the signed-in user to read aloud: in an open
--   language they speak; verified first, then unverified; never pending,
--   rejected or their own; on an active sentence they have not already
--   recorded in read-aloud mode or skipped recently; least-read first, ties
--   random. Same index-walk method as the other queue functions.
--   Output: translation_id, sentence_id, text.
--
-- next_sentence (speak) now only counts translate-and-speak recordings as
-- "already done", because a user may record a sentence once in each mode.
-- benchmark_next_sentence accepts the task 'read'.
-- =============================================================================

create table public.read_aloud_pool (
  translation_id  uuid primary key references public.translations (id) on delete cascade,
  language_id     uuid not null references public.languages (id) on delete cascade,
  sentence_id     uuid not null references public.sentences (id) on delete cascade,
  contributor_id  uuid not null,
  tier            smallint not null,
  read_count      integer not null default 0 check (read_count >= 0),
  is_active       boolean not null default true,
  random_key      double precision not null default random()
);
create index read_aloud_pool_queue_idx on public.read_aloud_pool (language_id, tier, read_count, random_key) where is_active;
create index read_aloud_pool_sentence_idx on public.read_aloud_pool (sentence_id);

insert into public.read_aloud_pool (translation_id, language_id, sentence_id, contributor_id, tier, read_count, is_active)
select t.id, t.language_id, t.sentence_id, t.contributor_id,
       case when t.status = 'verified' then 0 else 1 end,
       (select count(*) from public.recordings r
        where r.translation_id = t.id and r.mode = 'read_aloud' and r.status <> 'rejected'),
       s.is_active
from public.translations t join public.sentences s on s.id = t.sentence_id
where t.status in ('verified', 'unverified');

alter table public.read_aloud_pool enable row level security;
revoke all on public.read_aloud_pool from anon, authenticated;
grant select on public.read_aloud_pool to authenticated;
grant all on public.read_aloud_pool to service_role;
create policy "read_aloud_pool: admin read" on public.read_aloud_pool
  for select to authenticated using ((select public.is_admin()));

/**
 * sync_read_aloud_pool
 * Trigger after insert or update on translations. Adds, updates or removes
 * the translation's pool row according to its status.
 * Input: the new translation row. Output: null.
 */
create or replace function public.sync_read_aloud_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('verified', 'unverified') then
    insert into public.read_aloud_pool (translation_id, language_id, sentence_id, contributor_id, tier, is_active)
    select new.id, new.language_id, new.sentence_id, new.contributor_id,
           case when new.status = 'verified' then 0 else 1 end, s.is_active
    from public.sentences s where s.id = new.sentence_id
    on conflict (translation_id) do update
      set tier = excluded.tier, language_id = excluded.language_id, sentence_id = excluded.sentence_id;
  else
    delete from public.read_aloud_pool where translation_id = new.id;
  end if;
  return null;
end;
$$;

create trigger sync_read_aloud_pool after insert or update of status, language_id, sentence_id on public.translations
  for each row execute function public.sync_read_aloud_pool();

/**
 * track_read_count
 * Trigger after insert, update or delete on recordings. Keeps
 * read_aloud_pool.read_count equal to the number of non-rejected read-aloud
 * recordings of each translation.
 * Input: OLD/NEW recording rows. Output: null.
 */
create or replace function public.track_read_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_id uuid := case when tg_op <> 'INSERT' and old.mode = 'read_aloud' and old.status <> 'rejected' then old.translation_id end;
  after_id  uuid := case when tg_op <> 'DELETE' and new.mode = 'read_aloud' and new.status <> 'rejected' then new.translation_id end;
begin
  if before_id is not distinct from after_id then
    return null;
  end if;
  if before_id is not null then
    update public.read_aloud_pool set read_count = greatest(read_count - 1, 0) where translation_id = before_id;
  end if;
  if after_id is not null then
    update public.read_aloud_pool set read_count = read_count + 1 where translation_id = after_id;
  end if;
  return null;
end;
$$;

create trigger track_read_count after insert or update or delete on public.recordings
  for each row execute function public.track_read_count();

/**
 * sync_coverage_flags (replaces the queue v2 version)
 * Trigger after a sentence's is_active or has_verified_french changes.
 * Copies them onto its coverage rows and is_active onto its read-aloud
 * pool rows.
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
  if old.is_active is distinct from new.is_active then
    update public.read_aloud_pool set is_active = new.is_active where sentence_id = new.id;
  end if;
  return null;
end;
$$;

/**
 * next_translation_for_read_aloud
 * Next translation for the read-aloud mode of the SPEAK task (see header).
 * Input: p_language_id, p_exclude (sentence ids to leave out, e.g. the one on
 * screen or waiting to upload).
 * Output: at most one row (translation_id, sentence_id, text).
 */
create or replace function public.next_translation_for_read_aloud(p_language_id uuid, p_exclude uuid[] default '{}')
returns table (translation_id uuid, sentence_id uuid, text text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user    uuid := auth.uid();
  v_cutoff  timestamptz;
  v_r       double precision := random();
  v_tier    smallint;
  v_min     integer;
  v_id      uuid;
begin
  if v_user is null or p_language_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.user_languages ul join public.languages l on l.id = ul.language_id
    where ul.user_id = v_user and ul.language_id = p_language_id
      and ul.ability in ('native', 'fluent') and l.status = 'open'
  ) then
    return;
  end if;

  select now() - skip_cooldown into v_cutoff from public.app_settings where id;

  select p.tier, p.read_count into v_tier, v_min
  from public.read_aloud_pool p
  where p.language_id = p_language_id and p.is_active
    and p.contributor_id <> v_user
    and not (p.sentence_id = any(coalesce(p_exclude, '{}')))
    and not exists (select 1 from public.recordings r
                    where r.sentence_id = p.sentence_id and r.language_id = p_language_id
                      and r.contributor_id = v_user and r.mode = 'read_aloud')
    and not exists (select 1 from public.sentence_skips k
                    where k.user_id = v_user and k.language_id = p_language_id
                      and k.sentence_id = p.sentence_id and k.created_at > v_cutoff)
  order by p.tier, p.read_count
  limit 1;

  if v_tier is null then
    return;
  end if;

  select p.translation_id into v_id
  from public.read_aloud_pool p
  where p.language_id = p_language_id and p.is_active and p.tier = v_tier and p.read_count = v_min
    and p.random_key >= v_r
    and p.contributor_id <> v_user
    and not (p.sentence_id = any(coalesce(p_exclude, '{}')))
    and not exists (select 1 from public.recordings r
                    where r.sentence_id = p.sentence_id and r.language_id = p_language_id
                      and r.contributor_id = v_user and r.mode = 'read_aloud')
    and not exists (select 1 from public.sentence_skips k
                    where k.user_id = v_user and k.language_id = p_language_id
                      and k.sentence_id = p.sentence_id and k.created_at > v_cutoff)
  order by p.random_key
  limit 1;

  if v_id is null then
    select p.translation_id into v_id
    from public.read_aloud_pool p
    where p.language_id = p_language_id and p.is_active and p.tier = v_tier and p.read_count = v_min
      and p.random_key < v_r
      and p.contributor_id <> v_user
      and not (p.sentence_id = any(coalesce(p_exclude, '{}')))
      and not exists (select 1 from public.recordings r
                      where r.sentence_id = p.sentence_id and r.language_id = p_language_id
                        and r.contributor_id = v_user and r.mode = 'read_aloud')
      and not exists (select 1 from public.sentence_skips k
                      where k.user_id = v_user and k.language_id = p_language_id
                        and k.sentence_id = p.sentence_id and k.created_at > v_cutoff)
    order by p.random_key
    limit 1;
  end if;

  if v_id is null then
    return;
  end if;

  return query select t.id, t.sentence_id, t.text from public.translations t where t.id = v_id;
end;
$$;

/**
 * next_sentence (replaces the queue v2 version)
 * Unchanged except that, for the speak task, only translate-and-speak
 * recordings count as "already done".
 * Input: p_task ('write' | 'speak'), p_language_id, p_exclude.
 * Output: at most one row (sentence_id, anchor_text, anchor_language_id, anchor_iso_code).
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
  v_done        text;
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

  v_column := case p_task when 'write' then 'translation_count' when 'speak' then 'recording_count' end;
  v_done   := case p_task
                when 'write' then 'select 1 from public.translations d where d.sentence_id = c.sentence_id and d.language_id = $1 and d.contributor_id = $2'
                when 'speak' then 'select 1 from public.recordings d where d.sentence_id = c.sentence_id and d.language_id = $1 and d.contributor_id = $2 and d.mode = ''translate_and_speak'''
              end;
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
     and not exists (%s)
     and not exists (select 1 from public.sentence_skips k where k.user_id = $2 and k.language_id = $1
                     and k.sentence_id = c.sentence_id and k.created_at > $6)',
    v_filter, v_done
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
 * benchmark_next_sentence (replaces the queue v2 version)
 * Times a queue function inside the database, acting as the given user.
 * Service role only.
 * Input: p_user, p_language_id, p_task ('write' | 'speak' | 'read'), p_runs.
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
  for i in 0 .. greatest(p_runs, 1) loop
    v_started := clock_timestamp();
    if p_task = 'read' then
      perform * from public.next_translation_for_read_aloud(p_language_id);
    else
      perform * from public.next_sentence(p_task, p_language_id);
    end if;
    if i > 0 then
      v_total := v_total + (clock_timestamp() - v_started);
    end if;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  return round((extract(epoch from v_total) * 1000 / greatest(p_runs, 1))::numeric, 2);
end;
$$;

revoke execute on function public.sync_read_aloud_pool()                          from public, anon, authenticated;
revoke execute on function public.track_read_count()                              from public, anon, authenticated;
revoke execute on function public.next_translation_for_read_aloud(uuid, uuid[])   from public, anon;
grant  execute on function public.next_translation_for_read_aloud(uuid, uuid[])   to authenticated;
