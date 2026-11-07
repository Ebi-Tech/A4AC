-- =============================================================================
-- 14 · SPEAK task: recording rules and audio storage
--
-- recordings
--   + mime_type   the type MediaRecorder produced, e.g. "audio/webm;codecs=opus"
--                 or "audio/mp4". Files are stored exactly as recorded.
--   seen_anchor_language_id is now only required for translate_and_speak (a
--   read-aloud recording shows the translation, not an anchor).
--
-- app_settings
--   + recording_min_ms (1000), recording_max_ms (15000),
--     recording_min_speech_ms (500, used by the client check),
--     recording_rate_limit (60) per recording_rate_window (10 minutes)
--
-- Bucket "recordings": max 1 MB per file, only audio/webm, audio/ogg and
-- audio/mp4; uploads must sit in the user's own folder and end in .webm,
-- .ogg, .m4a or .mp4.
--
-- Rules on recordings (friendly messages, rule name in the error HINT):
--   no_file        the audio file must already exist at storage_path in the
--                  contributor's folder (the app uploads first, then inserts)
--   duration       duration_ms between recording_min_ms and recording_max_ms
--   duplicate      one recording per user, sentence, language and mode
--   bad_source     read-aloud must point to a verified or unverified
--                  translation of the same sentence and language that the
--                  user did not write
--   not_spoken / language_closed / rate_limit   as for translations
-- The service role is exempt from the file and content checks; admins are
-- exempt from the language and rate rules.
--
-- Audio files are removed by the app whenever it deletes a recording, and by
-- the cleanup-orphans script for anything left without a row.
-- =============================================================================

alter table public.recordings add column mime_type text;
update public.recordings set mime_type = 'audio/webm' where mime_type is null;
alter table public.recordings
  alter column mime_type set not null,
  add constraint recordings_mime_type_check check (mime_type ~ '^audio/(webm|ogg|mp4)(;.*)?$');

alter table public.recordings alter column seen_anchor_language_id drop not null;
alter table public.recordings
  add constraint recordings_seen_anchor_for_translate
  check (mode = 'read_aloud' or seen_anchor_language_id is not null);

create unique index recordings_one_per_mode on public.recordings (sentence_id, language_id, contributor_id, mode);
create index recordings_rate_idx on public.recordings (contributor_id, created_at desc);

alter table public.app_settings
  add column recording_min_ms         integer  not null default 1000  check (recording_min_ms > 0),
  add column recording_max_ms         integer  not null default 15000 check (recording_max_ms > 0),
  add column recording_min_speech_ms  integer  not null default 500   check (recording_min_speech_ms >= 0),
  add column recording_rate_limit     integer  not null default 60    check (recording_rate_limit > 0),
  add column recording_rate_window    interval not null default '10 minutes';

update storage.buckets
   set file_size_limit = 1048576,
       allowed_mime_types = array['audio/webm', 'audio/ogg', 'audio/mp4']
 where id = 'recordings';

drop policy "recordings bucket: upload into own folder" on storage.objects;
create policy "recordings bucket: upload into own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) in ('webm', 'ogg', 'm4a', 'mp4')
  );

/**
 * rule_error
 * Raises a friendly error for a broken contribution rule, with the rule name
 * in the HINT so the app and tests can tell rules apart.
 * Input: p_rule (rule name), p_message (text shown to the contributor).
 * Output: none (always raises).
 */
create or replace function public.rule_error(p_rule text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_message using errcode = 'check_violation', hint = p_rule;
end;
$$;

/**
 * validate_seen_anchor (replaces the prompt-3 version)
 * Same checks as before, but a null seen_anchor_language_id is accepted
 * (read-aloud recordings; the table's check constraint decides where null is
 * allowed).
 * Input: the new row. Output: the row unchanged, or an exception.
 */
create or replace function public.validate_seen_anchor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  anchor_flag boolean;
  own_language uuid;
begin
  if new.seen_anchor_language_id is null then
    return new;
  end if;

  select is_anchor into anchor_flag from public.languages where id = new.seen_anchor_language_id;
  if not coalesce(anchor_flag, false) then
    raise exception 'seen_anchor_language_id must be an anchor language' using errcode = 'check_violation';
  end if;

  select anchor_language_id into own_language from public.sentences where id = new.sentence_id;
  if new.seen_anchor_language_id is distinct from own_language and not exists (
    select 1 from public.translations f
    where f.sentence_id = new.sentence_id
      and f.language_id = new.seen_anchor_language_id
      and f.status = 'verified'
  ) then
    raise exception 'This sentence has no verified version in that anchor language' using errcode = 'check_violation';
  end if;

  if not public.is_privileged() and not exists (
    select 1 from public.user_languages ul
    where ul.user_id = auth.uid() and ul.language_id = new.seen_anchor_language_id
  ) then
    raise exception 'Add this anchor language to your profile before using it' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

/**
 * validate_recording (replaces the prompt-1 version)
 * Same checks as before (audio path inside the contributor's folder; the
 * translation belongs to the same sentence and language), now SECURITY
 * DEFINER so a translation the user cannot see (another user's rejected one)
 * reaches validate_speak and gets its friendly "bad_source" message instead
 * of a misleading one.
 * Input: the new row. Output: the row unchanged, or an exception.
 */
create or replace function public.validate_recording()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  anchor_id uuid;
begin
  if split_part(new.storage_path, '/', 1) <> new.contributor_id::text then
    raise exception 'storage_path must start with the contributor id folder'
      using errcode = 'check_violation';
  end if;

  if new.translation_id is not null then
    select sentence_id, language_id into t from public.translations where id = new.translation_id;
    if t.sentence_id is distinct from new.sentence_id or t.language_id is distinct from new.language_id then
      raise exception 'translation_id must belong to the same sentence and language'
        using errcode = 'check_violation';
    end if;
  elsif new.mode = 'read_aloud' then
    select anchor_language_id into anchor_id from public.sentences where id = new.sentence_id;
    if anchor_id is distinct from new.language_id then
      raise exception 'read_aloud needs a translation_id unless reading the anchor sentence in its own language'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_recording() from public, anon, authenticated;

/**
 * validate_speak
 * Trigger before insert on recordings (runs after validate_recording's path
 * check). Applies the speak rules listed in the header.
 * Input: the new row. Output: the row unchanged, or an exception.
 */
create or replace function public.validate_speak()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.app_settings;
  source   record;
  recent   integer;
begin
  if current_user in ('supabase_admin', 'service_role') or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  select * into settings from public.app_settings where id;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'recordings'
      and o.name = new.storage_path
      and (o.owner_id is null or o.owner_id = new.contributor_id::text)
  ) then
    perform public.rule_error('no_file', 'We could not find your audio file. Please record it again.');
  end if;

  if new.duration_ms is null
     or new.duration_ms < settings.recording_min_ms
     or new.duration_ms > settings.recording_max_ms then
    perform public.rule_error(
      'duration',
      format('Recordings need to be between %s and %s seconds long.',
             settings.recording_min_ms / 1000.0, settings.recording_max_ms / 1000.0)
    );
  end if;

  if exists (
    select 1 from public.recordings r
    where r.sentence_id = new.sentence_id and r.language_id = new.language_id
      and r.contributor_id = new.contributor_id and r.mode = new.mode
  ) then
    perform public.rule_error('duplicate', 'You already recorded this sentence. Thank you!');
  end if;

  if new.mode = 'read_aloud' and new.translation_id is not null then
    select t.sentence_id, t.language_id, t.status, t.contributor_id into source
    from public.translations t where t.id = new.translation_id;
    if source.sentence_id is distinct from new.sentence_id
       or source.language_id is distinct from new.language_id
       or source.status not in ('verified', 'unverified')
       or source.contributor_id = new.contributor_id then
      perform public.rule_error('bad_source', 'This text cannot be read aloud right now. Please try another sentence.');
    end if;
  end if;

  if (select role from public.profiles where id = auth.uid()) = 'admin' then
    return new;
  end if;

  if (select status from public.languages where id = new.language_id) is distinct from 'open' then
    perform public.rule_error('language_closed', 'This language is not open for contributions yet.');
  end if;

  if not exists (
    select 1 from public.user_languages ul
    where ul.user_id = new.contributor_id and ul.language_id = new.language_id and ul.ability in ('native', 'fluent')
  ) then
    perform public.rule_error('not_spoken', 'Add this language to your profile as a language you speak before recording in it.');
  end if;

  select count(*) into recent from (
    select 1 from public.recordings r
    where r.contributor_id = new.contributor_id and r.created_at > now() - settings.recording_rate_window
    limit settings.recording_rate_limit
  ) as window_rows;
  if recent >= settings.recording_rate_limit then
    perform public.rule_error('rate_limit', 'You have recorded a lot in a short time. Take a short break and come back in a few minutes.');
  end if;

  return new;
end;
$$;

create trigger validate_speak before insert on public.recordings
  for each row execute function public.validate_speak();

revoke execute on function public.validate_speak() from public, anon, authenticated;
