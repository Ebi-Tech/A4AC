-- =============================================================================
-- 12 · WRITE task: settings, skips, reports and translation rules
--
-- languages.special_characters   letters offered as tap-to-insert buttons
-- profiles.last_language_id      language last chosen on /contribute
--                                (users may update it themselves)
-- app_settings                   + translation_min_ratio / max_ratio (length
--                                of a translation vs the anchor it was written
--                                from), translation_rate_limit per
--                                translation_rate_window, skip_cooldown
-- sentence_skips                 "not sure", "unclear" or "report"; a skipped
--                                sentence is not offered again to that user
--                                in that language for skip_cooldown (7 days)
-- sentence_reports               created automatically from "report" skips;
--                                admins dismiss them or deactivate the sentence
--                                with resolve_sentence_report()
--
-- Rules on translations (database-enforced, friendly messages; the error
-- HINT names the rule so the app and tests can tell them apart):
--   empty, copy (same as an anchor text), contact (URL, email or phone
--   number), too_long / too_short (length ratio), duplicate (one translation
--   per user, sentence and language; replaces the old per-text unique key),
--   not_spoken (target language not listed as native/fluent), language_closed
--   (target language not open), rate_limit (too many in the time window).
-- The content rules apply to everyone except the service role; the
-- language and rate rules do not apply to admins (e.g. adding French anchors).
-- Contributors may now delete their own pending translations.
-- =============================================================================

alter table public.languages add column special_characters text[] not null default '{}';

update public.languages set special_characters = case iso_code
  when 'yor' then array['ẹ','ọ','ṣ','á','à','é','è','í','ì','ó','ò','ú','ù','ń','ẹ́','ẹ̀','ọ́','ọ̀','Ẹ','Ọ','Ṣ']
  when 'ibo' then array['ị','ọ','ụ','ṅ','á','à','é','è','í','ì','ó','ò','ú','ù','Ị','Ọ','Ụ','Ṅ']
  when 'hau' then array['ɓ','ɗ','ƙ','ƴ','ʼ','Ɓ','Ɗ','Ƙ','Ƴ']
  else special_characters end
where iso_code in ('yor', 'ibo', 'hau');

alter table public.profiles add column last_language_id uuid references public.languages (id) on delete set null;

drop trigger guard_columns on public.profiles;
create trigger guard_columns before update on public.profiles
  for each row execute function public.guard_columns('display_name', 'onboarded_at', 'last_language_id');

alter table public.app_settings
  add column translation_min_ratio    numeric  not null default 0.25 check (translation_min_ratio > 0),
  add column translation_max_ratio    numeric  not null default 4    check (translation_max_ratio > 1),
  add column translation_rate_limit   integer  not null default 60   check (translation_rate_limit > 0),
  add column translation_rate_window  interval not null default '10 minutes',
  add column skip_cooldown            interval not null default '7 days';

create type public.skip_reason as enum ('not_sure', 'unclear', 'report');

create table public.sentence_skips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  sentence_id  uuid not null references public.sentences (id) on delete cascade,
  language_id  uuid not null references public.languages (id) on delete cascade,
  reason       public.skip_reason not null,
  note         text check (note is null or char_length(note) <= 500),
  created_at   timestamptz not null default now()
);
create index sentence_skips_lookup_idx on public.sentence_skips (user_id, language_id, sentence_id, created_at desc);

create table public.sentence_reports (
  id           uuid primary key default gen_random_uuid(),
  sentence_id  uuid not null references public.sentences (id) on delete cascade,
  reporter_id  uuid references public.profiles (id) on delete set null,
  language_id  uuid references public.languages (id) on delete set null,
  reason       text check (reason is null or char_length(reason) <= 500),
  status       public.flag_status not null default 'open',
  resolved_by  uuid references public.profiles (id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index sentence_reports_open_idx     on public.sentence_reports (created_at) where status = 'open';
create index sentence_reports_sentence_idx on public.sentence_reports (sentence_id);

create trigger set_updated_at before update on public.sentence_reports
  for each row execute function public.set_updated_at();

alter table public.translations drop constraint translations_sentence_id_language_id_contributor_id_text_key;
create unique index translations_one_per_user on public.translations (sentence_id, language_id, contributor_id);
create index translations_rate_idx on public.translations (contributor_id, created_at desc);

/**
 * report_from_skip
 * Trigger after a skip with reason 'report'. Creates the matching
 * sentence_reports row that admins review.
 * Input: the new skip row. Output: null.
 */
create or replace function public.report_from_skip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sentence_reports (sentence_id, reporter_id, language_id, reason)
  values (new.sentence_id, new.user_id, new.language_id, nullif(btrim(coalesce(new.note, '')), ''));
  return null;
end;
$$;

create trigger report_from_skip after insert on public.sentence_skips
  for each row when (new.reason = 'report')
  execute function public.report_from_skip();

/**
 * translation_error
 * Raises a friendly error for a broken translation rule. The rule name is
 * put in the HINT so the app can choose how to show it.
 * Input: p_rule (rule name), p_message (text shown to the contributor).
 * Output: none (always raises).
 */
create or replace function public.translation_error(p_rule text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_message using errcode = 'check_violation', hint = p_rule;
end;
$$;

/**
 * validate_translation
 * Trigger before insert, or update of text, on translations. Applies the
 * content rules (empty, copy, contact details, length ratio) to everyone but
 * the service role, and on insert the duplicate rule.
 * Input: the new row. Output: the row with trimmed text, or an exception.
 */
create or replace function public.validate_translation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  settings     public.app_settings;
  anchor_text  text;
  ratio        numeric;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  new.text := btrim(regexp_replace(coalesce(new.text, ''), '[[:space:]]+', ' ', 'g'));
  if new.text = '' then
    perform public.translation_error('empty', 'Please write something before submitting.');
  end if;

  if public.normalize_sentence(new.text) in (
    select public.normalize_sentence(s.text) from public.sentences s where s.id = new.sentence_id
    union all
    select public.normalize_sentence(t.text) from public.translations t
    join public.languages l on l.id = t.language_id
    where t.sentence_id = new.sentence_id and l.is_anchor and t.status = 'verified'
  ) then
    perform public.translation_error('copy', 'This looks the same as the sentence you were shown. Please write it in your language.');
  end if;

  if new.text ~* '(https?://|www\.|[[:alnum:]-]+\.(com|org|net|edu|gov|io|co|info|africa|ng|ke|rw|tz|fr|uk)([^[:alnum:]]|$))'
     or new.text ~ '[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+'
     or new.text ~ '[0-9]([ ().-]?[0-9]){6,}' then
    perform public.translation_error('contact', 'Please leave out web addresses, email addresses and phone numbers.');
  end if;

  select * into settings from public.app_settings where id;
  if new.seen_anchor_language_id = (select anchor_language_id from public.sentences where id = new.sentence_id) then
    select text into anchor_text from public.sentences where id = new.sentence_id;
  else
    select t.text into anchor_text from public.translations t
    where t.sentence_id = new.sentence_id and t.language_id = new.seen_anchor_language_id and t.status = 'verified'
    order by t.updated_at desc limit 1;
  end if;

  if anchor_text is not null and char_length(anchor_text) > 0 then
    ratio := char_length(new.text)::numeric / char_length(anchor_text);
    if ratio > settings.translation_max_ratio then
      perform public.translation_error('too_long', 'This is much longer than the sentence. Please translate just this one sentence.');
    end if;
    if ratio < settings.translation_min_ratio then
      perform public.translation_error('too_short', 'This seems much shorter than the sentence. Please translate the whole sentence.');
    end if;
  end if;

  if tg_op = 'INSERT' and exists (
    select 1 from public.translations t
    where t.sentence_id = new.sentence_id and t.language_id = new.language_id and t.contributor_id = new.contributor_id
  ) then
    perform public.translation_error('duplicate', 'You already translated this sentence. You can edit it from your profile.');
  end if;

  return new;
end;
$$;

create trigger validate_translation before insert or update of text on public.translations
  for each row execute function public.validate_translation();

/**
 * validate_write_language
 * Trigger before insert on translations. For non-privileged users the target
 * language must be open and listed by them as native or fluent, and they may
 * not exceed translation_rate_limit inserts per translation_rate_window.
 * Input: the new row. Output: the row unchanged, or an exception.
 */
create or replace function public.validate_write_language()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  settings public.app_settings;
  recent   integer;
begin
  if public.is_privileged() then
    return new;
  end if;

  if (select status from public.languages where id = new.language_id) is distinct from 'open' then
    perform public.translation_error('language_closed', 'This language is not open for contributions yet.');
  end if;

  if not exists (
    select 1 from public.user_languages ul
    where ul.user_id = new.contributor_id and ul.language_id = new.language_id and ul.ability in ('native', 'fluent')
  ) then
    perform public.translation_error('not_spoken', 'Add this language to your profile as a language you speak before writing in it.');
  end if;

  select * into settings from public.app_settings where id;
  select count(*) into recent from (
    select 1 from public.translations t
    where t.contributor_id = new.contributor_id and t.created_at > now() - settings.translation_rate_window
    limit settings.translation_rate_limit
  ) as window_rows;
  if recent >= settings.translation_rate_limit then
    perform public.translation_error('rate_limit', 'You have written a lot in a short time. Take a short break and come back in a few minutes.');
  end if;

  return new;
end;
$$;

create trigger validate_write_language before insert on public.translations
  for each row execute function public.validate_write_language();

/**
 * resolve_sentence_report
 * Admin action on a sentence report. 'dismiss' closes this report;
 * 'deactivate' deactivates the sentence and confirms every open report on it.
 * Input: p_report_id, p_action ('dismiss' | 'deactivate'). Output: none.
 */
create or replace function public.resolve_sentence_report(p_report_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sentence uuid;
begin
  perform public.require_admin();
  select sentence_id into v_sentence from public.sentence_reports where id = p_report_id and status = 'open' for update;
  if v_sentence is null then
    raise exception 'No open report with that id' using errcode = 'no_data_found';
  end if;

  if p_action = 'dismiss' then
    update public.sentence_reports
       set status = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
     where id = p_report_id;
  elsif p_action = 'deactivate' then
    update public.sentences set is_active = false where id = v_sentence;
    update public.sentence_reports
       set status = 'confirmed', resolved_by = auth.uid(), resolved_at = now()
     where sentence_id = v_sentence and status = 'open';
  else
    raise exception 'Unknown action %', p_action using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function public.report_from_skip()                     from public, anon, authenticated;
revoke execute on function public.resolve_sentence_report(uuid, text)    from public, anon;
grant  execute on function public.resolve_sentence_report(uuid, text)    to authenticated, service_role;

revoke all on public.sentence_skips, public.sentence_reports from anon, authenticated;
grant select, insert on public.sentence_skips   to authenticated;
grant select, update on public.sentence_reports to authenticated;
grant all on public.sentence_skips, public.sentence_reports to service_role;

alter table public.sentence_skips   enable row level security;
alter table public.sentence_reports enable row level security;

create policy "sentence_skips: read own or admin" on public.sentence_skips
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "sentence_skips: insert own" on public.sentence_skips
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "sentence_reports: read own or admin" on public.sentence_reports
  for select to authenticated using (reporter_id = (select auth.uid()) or (select public.is_admin()));
create policy "sentence_reports: admin update" on public.sentence_reports
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "translations: delete own pending" on public.translations
  for delete to authenticated using (contributor_id = (select auth.uid()) and status = 'pending');
