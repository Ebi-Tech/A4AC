-- =============================================================================
-- 03 · Business rules enforced in the database
--
-- Who is "privileged": admins (profiles.role = 'admin'), the service_role key,
-- and SECURITY DEFINER functions owned by postgres (for example future
-- vote-counting jobs). Privileged callers skip the edit guards below; everyone
-- else is held to the contributor rules.
--
-- Rules:
--   * New profiles are created automatically when an auth user signs up.
--   * A user cannot review or flag their own contribution (applies to everyone,
--     admins included).
--   * reviews/flags/gold_samples must point at a target that exists; deleting
--     a target removes its reviews, flags and gold sample rows.
--   * One review per reviewer per item (UNIQUE in 02). A reviewer may change
--     their verdict; each change writes one review_history row. Only the
--     current verdict counts.
--   * New contributions always start as 'pending' and new flags as 'open',
--     whatever the client sends.
--   * Translations and transcripts: the author may edit only the text, only
--     while pending, unverified or verified. Editing a verified row resets it
--     to pending. Rejected rows cannot be edited. Status cannot be set by hand.
--   * Recordings cannot be edited by contributors (delete + re-record instead).
--     storage_path must sit inside the contributor's own folder. A read_aloud
--     recording must reference a translation of the same sentence and
--     language, unless it is the anchor sentence read in its own language.
--   * Contributors cannot change their own role or trust_score.
-- =============================================================================

/**
 * is_admin
 * Tells whether the signed-in user has the admin role.
 * Input: none (uses auth.uid()). Output: boolean.
 * SECURITY DEFINER so RLS policies on profiles can call it without recursion.
 */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

/**
 * is_privileged
 * Tells whether the current caller may bypass contributor edit rules: an admin,
 * the service_role key, or code running as a database owner role.
 * Input: none. Output: boolean.
 * Deliberately NOT security definer, so current_user reflects the real caller.
 */
create or replace function public.is_privileged()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('postgres', 'supabase_admin', 'service_role')
      or coalesce(auth.role(), '') = 'service_role'
      or public.is_admin();
$$;

/**
 * contribution_owner
 * Looks up who created a translation, recording or transcript.
 * Input: p_type (target_type), p_id (uuid of the target row).
 * Output: the contributor's user id. Raises foreign_key_violation if the
 * target does not exist.
 */
create or replace function public.contribution_owner(p_type public.target_type, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  case p_type
    when 'translation' then select contributor_id into owner_id from public.translations where id = p_id;
    when 'recording'   then select contributor_id into owner_id from public.recordings   where id = p_id;
    when 'transcript'  then select contributor_id into owner_id from public.transcripts  where id = p_id;
  end case;

  if owner_id is null then
    raise exception '% % does not exist', p_type, p_id using errcode = 'foreign_key_violation';
  end if;

  return owner_id;
end;
$$;

/**
 * handle_new_user
 * Trigger on auth.users. Creates the matching profiles row when someone signs up,
 * taking display_name from the sign-up metadata if provided.
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
  values (new.id, left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 80));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/**
 * prevent_self_target
 * Trigger on reviews and flags. Blocks a user from reviewing or flagging their
 * own contribution and rejects targets that do not exist.
 * Input: the new row; TG_ARGV[0] names the actor column (reviewer_id / flagger_id).
 * Output: the row unchanged, or an exception.
 */
create or replace function public.prevent_self_target()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if public.contribution_owner(new.target_type, new.target_id) = actor_id then
    raise exception 'You cannot review or flag your own contribution'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger prevent_self_review
  before insert or update of target_type, target_id, reviewer_id on public.reviews
  for each row execute function public.prevent_self_target('reviewer_id');

create trigger prevent_self_flag
  before insert or update of target_type, target_id, flagger_id on public.flags
  for each row execute function public.prevent_self_target('flagger_id');

/**
 * check_target_exists
 * Trigger on gold_samples. Ensures (target_type, target_id) points at a real row.
 * Input: the new row. Output: the row unchanged, or an exception.
 */
create or replace function public.check_target_exists()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.contribution_owner(new.target_type, new.target_id);
  return new;
end;
$$;

create trigger check_target_exists
  before insert or update of target_type, target_id on public.gold_samples
  for each row execute function public.check_target_exists();

/**
 * cleanup_target_refs
 * Trigger after a translation, recording or transcript is deleted. Removes the
 * reviews, flags and gold samples that pointed at it.
 * Input: the deleted row; TG_ARGV[0] is its target_type. Output: null.
 */
create or replace function public.cleanup_target_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.reviews      where target_type = tg_argv[0]::public.target_type and target_id = old.id;
  delete from public.flags        where target_type = tg_argv[0]::public.target_type and target_id = old.id;
  delete from public.gold_samples where target_type = tg_argv[0]::public.target_type and target_id = old.id;
  return null;
end;
$$;

create trigger cleanup_target_refs after delete on public.translations
  for each row execute function public.cleanup_target_refs('translation');
create trigger cleanup_target_refs after delete on public.recordings
  for each row execute function public.cleanup_target_refs('recording');
create trigger cleanup_target_refs after delete on public.transcripts
  for each row execute function public.cleanup_target_refs('transcript');

/**
 * force_initial_status
 * Trigger before insert. For non-privileged callers, overwrites the status the
 * client sent with the required starting status.
 * Input: the new row; TG_ARGV[0] is the starting status ('pending' / 'open').
 * Output: the row with status set.
 */
create or replace function public.force_initial_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_privileged() then
    new := jsonb_populate_record(new, jsonb_build_object('status', tg_argv[0]));
  end if;
  return new;
end;
$$;

create trigger force_initial_status before insert on public.translations
  for each row execute function public.force_initial_status('pending');
create trigger force_initial_status before insert on public.recordings
  for each row execute function public.force_initial_status('pending');
create trigger force_initial_status before insert on public.transcripts
  for each row execute function public.force_initial_status('pending');
create trigger force_initial_status before insert on public.flags
  for each row execute function public.force_initial_status('open');

/**
 * guard_text_edit
 * Trigger before update on translations and transcripts. For non-privileged
 * callers: only the text may change, rejected rows are locked, the status
 * cannot be set by hand, and editing a verified row resets it to pending.
 * Input: OLD and NEW rows. Output: the adjusted NEW row, or an exception.
 */
create or replace function public.guard_text_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  editable constant text[] := array['text', 'status', 'updated_at'];
begin
  if public.is_privileged() then
    return new;
  end if;

  if (to_jsonb(new) - editable) is distinct from (to_jsonb(old) - editable) then
    raise exception 'Only the text of a % can be edited', tg_table_name
      using errcode = 'insufficient_privilege';
  end if;

  if old.status = 'rejected' then
    raise exception 'Rejected contributions cannot be edited'
      using errcode = 'insufficient_privilege';
  end if;

  if new.text is distinct from old.text and old.status = 'verified' then
    new.status := 'pending';
  else
    new.status := old.status;
  end if;

  return new;
end;
$$;

create trigger guard_text_edit before update on public.translations
  for each row execute function public.guard_text_edit();
create trigger guard_text_edit before update on public.transcripts
  for each row execute function public.guard_text_edit();

/**
 * validate_recording
 * Trigger before insert on recordings. Checks the audio path is inside the
 * contributor's folder and that read_aloud recordings reference a matching
 * translation (or are the anchor sentence in its own language).
 * Input: the new row. Output: the row unchanged, or an exception.
 */
create or replace function public.validate_recording()
returns trigger
language plpgsql
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

create trigger validate_recording before insert on public.recordings
  for each row execute function public.validate_recording();

/**
 * block_contributor_update
 * Trigger before update on recordings. Recordings are immutable for
 * contributors; only privileged callers (admins, service role) may update them.
 * Input: OLD and NEW rows. Output: NEW, or an exception.
 */
create or replace function public.block_contributor_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_privileged() then
    raise exception '% rows cannot be edited; delete and create a new one instead', tg_table_name
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger block_contributor_update before update on public.recordings
  for each row execute function public.block_contributor_update();

/**
 * guard_columns
 * Trigger before update. For non-privileged callers, rejects the update if any
 * column outside the allowed list changed.
 * Input: OLD and NEW rows; TG_ARGV holds the editable column names.
 * Output: NEW, or an exception.
 */
create or replace function public.guard_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  editable text[] := array_append(tg_argv::text[], 'updated_at');
begin
  if not public.is_privileged()
     and (to_jsonb(new) - editable) is distinct from (to_jsonb(old) - editable) then
    raise exception 'Only these % columns can be edited: %', tg_table_name, array_to_string(tg_argv, ', ')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger guard_columns before update on public.reviews
  for each row execute function public.guard_columns('verdict', 'shown_flag_after_vote', 'agrees_with_flag');
create trigger guard_columns before update on public.profiles
  for each row execute function public.guard_columns('display_name', 'consent_accepted_at', 'is_adult_confirmed');
create trigger guard_columns before update on public.user_languages
  for each row execute function public.guard_columns('ability');

/**
 * log_review_change
 * Trigger after a review's verdict changes. Appends one review_history row
 * with the old and new verdict. SECURITY DEFINER because review_history
 * accepts no direct writes.
 * Input: OLD and NEW review rows. Output: null.
 */
create or replace function public.log_review_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.review_history (review_id, previous_verdict, new_verdict)
  values (new.id, old.verdict, new.verdict);
  return null;
end;
$$;

create trigger log_review_change
  after update of verdict on public.reviews
  for each row
  when (old.verdict is distinct from new.verdict)
  execute function public.log_review_change();

revoke execute on function public.handle_new_user()     from public, anon, authenticated;
revoke execute on function public.cleanup_target_refs() from public, anon, authenticated;
revoke execute on function public.log_review_change()   from public, anon, authenticated;
