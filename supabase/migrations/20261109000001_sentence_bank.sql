-- =============================================================================
-- 09 · One shared sentence bank
--
-- English is the canonical anchor: every sentence lives once in `sentences`
-- (in English). A French version is a translation of the same sentence in
-- language "fra" and only counts as an anchor once it is verified.
--
-- sentences
--   + topic            optional label for filtering
--   + random_key       fixed random number, used to pick ties randomly
--                      through an index instead of ORDER BY random()
--   + normalized_text  lower-case, punctuation-free copy used to block
--                      duplicates (case and punctuation insensitive). It
--                      replaces the old exact-text unique constraint.
--   A sentence that has translations or recordings cannot be deleted and its
--   text cannot change (deactivate it and add a corrected one instead).
--
-- translations, recordings
--   + seen_anchor_language_id  which anchor language the contributor saw.
--   Checked on insert: it must be an anchor language; if it is not the
--   sentence's own language a verified version in it must exist; the
--   contributor must have said they understand it (admins exempt); and a
--   translation cannot be in the language that was shown.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

/**
 * normalize_sentence
 * Builds the duplicate-detection key for a sentence: lower case, punctuation
 * removed, whitespace collapsed.
 * Input: p_text. Output: the normalised text.
 */
create or replace function public.normalize_sentence(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(lower(p_text), '[^[:alnum:][:space:]]+', '', 'g'), '[[:space:]]+', ' ', 'g'));
$$;

alter table public.sentences
  add column topic           text check (topic is null or char_length(btrim(topic)) between 1 and 50),
  add column random_key      double precision not null default random(),
  add column normalized_text text generated always as (public.normalize_sentence(text)) stored;

alter table public.sentences drop constraint sentences_anchor_language_id_text_key;
create unique index sentences_normalized_unique  on public.sentences (anchor_language_id, normalized_text);
create index sentences_topic_idx                 on public.sentences (topic) where topic is not null;
create index sentences_active_random_idx         on public.sentences (random_key) where is_active;
create index sentences_text_trgm_idx             on public.sentences using gin (text extensions.gin_trgm_ops);

alter table public.translations add column seen_anchor_language_id uuid references public.languages (id) on delete restrict;
alter table public.recordings   add column seen_anchor_language_id uuid references public.languages (id) on delete restrict;

update public.translations t set seen_anchor_language_id = s.anchor_language_id
  from public.sentences s where s.id = t.sentence_id and t.seen_anchor_language_id is null;
update public.recordings r set seen_anchor_language_id = s.anchor_language_id
  from public.sentences s where s.id = r.sentence_id and r.seen_anchor_language_id is null;

alter table public.translations
  alter column seen_anchor_language_id set not null,
  add constraint translations_not_into_seen_anchor check (seen_anchor_language_id <> language_id);
alter table public.recordings
  alter column seen_anchor_language_id set not null;

create index translations_verified_anchor_idx on public.translations (sentence_id, language_id, updated_at desc) where status = 'verified';
create index translations_mine_idx            on public.translations (contributor_id, language_id, sentence_id);
create index recordings_mine_idx              on public.recordings (contributor_id, language_id, sentence_id);

/**
 * validate_seen_anchor
 * Trigger before insert on translations and recordings. Checks that
 * seen_anchor_language_id is an anchor language, that a verified version of
 * the sentence exists in it (unless it is the sentence's own language), and
 * that a non-admin contributor said they understand it.
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

create trigger validate_seen_anchor before insert on public.translations
  for each row execute function public.validate_seen_anchor();
create trigger validate_seen_anchor before insert on public.recordings
  for each row execute function public.validate_seen_anchor();

/**
 * protect_used_sentence
 * Trigger before delete, or update of text, on sentences. A sentence that
 * already has translations or recordings can be neither deleted nor
 * reworded, because contributions refer to its exact text.
 * Input: OLD (and NEW) rows. Output: the row to continue with, or an exception.
 */
create or replace function public.protect_used_sentence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.translations where sentence_id = old.id)
     or exists (select 1 from public.recordings where sentence_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception 'This sentence has contributions. Deactivate it instead of deleting it'
        using errcode = 'restrict_violation';
    end if;
    raise exception 'This sentence has contributions, so its text cannot change. Deactivate it and add a corrected sentence'
      using errcode = 'restrict_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger protect_used_sentence_delete before delete on public.sentences
  for each row execute function public.protect_used_sentence();
create trigger protect_used_sentence_text before update of text on public.sentences
  for each row when (old.text is distinct from new.text)
  execute function public.protect_used_sentence();

revoke execute on function public.protect_used_sentence() from public, anon, authenticated;
