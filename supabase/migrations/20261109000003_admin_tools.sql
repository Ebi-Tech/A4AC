-- =============================================================================
-- 11 · Admin tools
--
-- Functions behind the /admin pages. Every function starts with
-- require_admin(), so calling them as a contributor fails even though they are
-- exposed through the API. The service role (scripts) is allowed too.
--
--   approve_language_request   creates the language (or reuses one with the
--                              same ISO code) and marks the request "added"
--   decline_language_request   marks a pending request "declined"
--   admin_anchor_list          sentences with the status of their French
--                              version (missing / unverified / verified)
--   admin_sentence_usage       how many translations and recordings each
--                              sentence has (decides whether delete is allowed)
--   find_existing_sentences    which of the given texts already exist in the
--                              bank (case and punctuation insensitive), used
--                              by the import script and bulk upload
--   sentence_topics            distinct topics, for filter menus (any
--                              signed-in user)
-- =============================================================================

/**
 * require_admin
 * Raises unless the caller is an admin or uses the service role key.
 * Input: none. Output: none.
 */
create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'Admins only' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

/**
 * approve_language_request
 * Approves a pending language request: creates the language unless one with
 * this ISO code already exists, then marks the request as added.
 * Input: p_request_id, p_iso_code (ISO 639-3), p_name, p_native_name
 * (optional), p_status (status for a newly created language).
 * Output: the id of the created or existing language.
 */
create or replace function public.approve_language_request(
  p_request_id  uuid,
  p_iso_code    text,
  p_name        text,
  p_native_name text default null,
  p_status      public.language_status default 'open'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_language_id uuid;
  v_status public.language_request_status;
begin
  perform public.require_admin();

  select status into v_status from public.language_requests where id = p_request_id for update;
  if v_status is null then
    raise exception 'Language request not found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'pending' then
    raise exception 'This request was already %', v_status using errcode = 'check_violation';
  end if;

  insert into public.languages (iso_code, name, native_name, is_anchor, status)
  values (lower(btrim(p_iso_code)), btrim(p_name), nullif(btrim(p_native_name), ''), false, p_status)
  on conflict (iso_code) do nothing
  returning id into v_language_id;

  if v_language_id is null then
    select id into v_language_id from public.languages where iso_code = lower(btrim(p_iso_code));
  end if;

  update public.language_requests set status = 'added' where id = p_request_id;
  return v_language_id;
end;
$$;

/**
 * decline_language_request
 * Declines a pending language request.
 * Input: p_request_id. Output: none.
 */
create or replace function public.decline_language_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.language_requests set status = 'declined' where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'No pending request with that id' using errcode = 'no_data_found';
  end if;
end;
$$;

/**
 * admin_anchor_list
 * Lists sentences with the state of their French version. For each sentence
 * the shown French text is the newest verified one, or else the newest
 * non-rejected one.
 * Input: p_search (text filter, optional), p_filter ('all' | 'missing' |
 * 'unverified' | 'verified'), p_limit, p_offset.
 * Output: one row per sentence plus total_count (rows matching the filter).
 */
create or replace function public.admin_anchor_list(
  p_search text default null,
  p_filter text default 'all',
  p_limit  integer default 25,
  p_offset integer default 0
)
returns table (
  sentence_id            uuid,
  text                   text,
  topic                  text,
  is_active              boolean,
  french_translation_id  uuid,
  french_text            text,
  french_status          text,
  total_count            bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_fra uuid;
begin
  perform public.require_admin();
  select id into v_fra from public.languages where iso_code = 'fra';

  return query
  with base as (
    select s.id, s.text, s.topic, s.is_active, s.created_at, fr.id as fr_id, fr.text as fr_text,
           case when fr.id is null then 'missing'
                when fr.status = 'verified' then 'verified'
                else 'unverified' end as fr_state
    from public.sentences s
    left join lateral (
      select t.id, t.text, t.status
      from public.translations t
      where t.sentence_id = s.id and t.language_id = v_fra and t.status <> 'rejected'
      order by (t.status = 'verified') desc, t.updated_at desc
      limit 1
    ) fr on true
    where p_search is null or p_search = '' or s.text ilike '%' || p_search || '%'
  )
  select b.id, b.text, b.topic, b.is_active, b.fr_id, b.fr_text, b.fr_state, count(*) over ()
  from base b
  where coalesce(p_filter, 'all') = 'all' or b.fr_state = p_filter
  order by b.created_at desc, b.id
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end;
$$;

/**
 * admin_sentence_usage
 * Counts all translations and recordings (any status) for each given sentence.
 * Input: p_ids (sentence ids). Output: sentence_id, translations, recordings.
 */
create or replace function public.admin_sentence_usage(p_ids uuid[])
returns table (sentence_id uuid, translations bigint, recordings bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
  select i.id,
         (select count(*) from public.translations t where t.sentence_id = i.id),
         (select count(*) from public.recordings r where r.sentence_id = i.id)
  from unnest(p_ids) as i(id);
end;
$$;

/**
 * find_existing_sentences
 * Returns those input texts whose normalised form is already in the bank.
 * Input: p_texts. Output: the matching input texts.
 */
create or replace function public.find_existing_sentences(p_texts text[])
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select t from unnest(p_texts) as t
  where exists (select 1 from public.sentences s where s.normalized_text = public.normalize_sentence(t));
end;
$$;

/**
 * sentence_topics
 * Lists the distinct topics in use, alphabetically.
 * Input: none. Output: one topic per row.
 */
create or replace function public.sentence_topics()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct topic from public.sentences where topic is not null order by topic;
$$;

create index sentences_normalized_idx on public.sentences (normalized_text);

revoke execute on function public.require_admin()                                                     from public, anon;
revoke execute on function public.approve_language_request(uuid, text, text, text, public.language_status) from public, anon;
revoke execute on function public.decline_language_request(uuid)                                      from public, anon;
revoke execute on function public.admin_anchor_list(text, text, integer, integer)                     from public, anon;
revoke execute on function public.admin_sentence_usage(uuid[])                                        from public, anon;
revoke execute on function public.find_existing_sentences(text[])                                     from public, anon;
revoke execute on function public.sentence_topics()                                                   from public, anon;
grant execute on function public.require_admin()                                                      to authenticated, service_role;
grant execute on function public.approve_language_request(uuid, text, text, text, public.language_status) to authenticated, service_role;
grant execute on function public.decline_language_request(uuid)                                       to authenticated, service_role;
grant execute on function public.admin_anchor_list(text, text, integer, integer)                      to authenticated, service_role;
grant execute on function public.admin_sentence_usage(uuid[])                                         to authenticated, service_role;
grant execute on function public.find_existing_sentences(text[])                                      to authenticated, service_role;
grant execute on function public.sentence_topics()                                                    to authenticated, service_role;
