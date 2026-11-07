-- =============================================================================
-- 08 · Counts for the Languages and Profile pages
--
-- language_stats()          every language with its status and counts of
--                           non-rejected translations, recordings and distinct
--                           contributors (translations, recordings and
--                           transcripts). Aggregated in the database so the page
--                           never loads contribution rows. Callable by
--                           signed-out visitors; returns no personal data.
-- my_contribution_counts()  the signed-in user's own totals per task.
-- =============================================================================

/**
 * language_stats
 * Lists every language with its status and contribution counts.
 * Input: none. Output: one row per language (anchors first, then by name).
 */
create or replace function public.language_stats()
returns table (
  language_id   uuid,
  iso_code      text,
  name          text,
  native_name   text,
  is_anchor     boolean,
  status        public.language_status,
  translations  bigint,
  recordings    bigint,
  contributors  bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select language_id, count(*) as n
    from public.translations where status <> 'rejected'
    group by language_id
  ),
  r as (
    select language_id, count(*) as n
    from public.recordings where status <> 'rejected'
    group by language_id
  ),
  c as (
    select language_id, count(distinct contributor_id) as n
    from (
      select language_id, contributor_id from public.translations where status <> 'rejected'
      union all
      select language_id, contributor_id from public.recordings where status <> 'rejected'
      union all
      select rec.language_id, tr.contributor_id
      from public.transcripts tr
      join public.recordings rec on rec.id = tr.recording_id
      where tr.status <> 'rejected'
    ) as all_contributions
    group by language_id
  )
  select l.id, l.iso_code, l.name, l.native_name, l.is_anchor, l.status,
         coalesce(t.n, 0), coalesce(r.n, 0), coalesce(c.n, 0)
  from public.languages l
  left join t on t.language_id = l.id
  left join r on r.language_id = l.id
  left join c on c.language_id = l.id
  order by l.is_anchor desc, l.name;
$$;

grant execute on function public.language_stats() to anon, authenticated;

/**
 * my_contribution_counts
 * Counts the signed-in user's own translations, recordings, transcripts and
 * current (non-stale) reviews.
 * Input: none. Output: one row of counts (zeros when signed out).
 */
create or replace function public.my_contribution_counts()
returns table (translations bigint, recordings bigint, transcripts bigint, reviews bigint)
language sql
stable
set search_path = ''
as $$
  select
    (select count(*) from public.translations where contributor_id = auth.uid()),
    (select count(*) from public.recordings   where contributor_id = auth.uid()),
    (select count(*) from public.transcripts  where contributor_id = auth.uid()),
    (select count(*) from public.reviews      where reviewer_id = auth.uid() and not is_stale);
$$;

revoke execute on function public.my_contribution_counts() from public, anon;
grant  execute on function public.my_contribution_counts() to authenticated;
