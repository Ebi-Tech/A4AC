-- =============================================================================
-- 06 · Stale reviews (fix from prompt 1)
--
-- Any change to the text of a translation or transcript now resets its status
-- to 'pending', whatever the previous status was (rejected rows stay locked
-- for contributors). Reviews of the old text are kept but marked
-- is_stale = true, so they no longer count.
--
-- A reviewer can re-vote on the new text by updating their stale review
-- (even with the same verdict); that clears is_stale.
--
-- All vote counting must use the review_votes view (or filter
-- "not is_stale" itself). The view runs with the caller's permissions, so
-- contributors see only their own votes; counting jobs use the service role.
-- =============================================================================

alter table public.reviews add column is_stale boolean not null default false;

create index reviews_current_target_idx on public.reviews (target_type, target_id) where not is_stale;

/**
 * guard_text_edit (replaces the prompt-1 version)
 * Trigger before update on translations and transcripts.
 * Non-privileged callers may change only the text, cannot edit rejected rows
 * and cannot set the status. For every caller, a text change resets the status
 * to pending unless a privileged caller sets a status in the same update.
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
  if not public.is_privileged() then
    if (to_jsonb(new) - editable) is distinct from (to_jsonb(old) - editable) then
      raise exception 'Only the text of a % can be edited', tg_table_name
        using errcode = 'insufficient_privilege';
    end if;
    if old.status = 'rejected' then
      raise exception 'Rejected contributions cannot be edited'
        using errcode = 'insufficient_privilege';
    end if;
    new.status := old.status;
  end if;

  if new.text is distinct from old.text and new.status is not distinct from old.status then
    new.status := 'pending';
  end if;

  return new;
end;
$$;

/**
 * mark_reviews_stale
 * Trigger after the text of a translation or transcript changes. Marks every
 * current review of that item as stale.
 * Input: OLD and NEW rows; TG_ARGV[0] is the target_type. Output: null.
 */
create or replace function public.mark_reviews_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.reviews
     set is_stale = true
   where target_type = tg_argv[0]::public.target_type
     and target_id = new.id
     and not is_stale;
  return null;
end;
$$;

create trigger mark_reviews_stale
  after update of text on public.translations
  for each row when (old.text is distinct from new.text)
  execute function public.mark_reviews_stale('translation');

create trigger mark_reviews_stale
  after update of text on public.transcripts
  for each row when (old.text is distinct from new.text)
  execute function public.mark_reviews_stale('transcript');

revoke execute on function public.mark_reviews_stale() from public, anon, authenticated;

/**
 * set_review_freshness
 * Trigger before update on reviews. When the reviewer updates their own stale
 * review, the update counts as a fresh vote on the current text, so is_stale
 * is cleared. Updates that set is_stale themselves are left alone.
 * Input: OLD and NEW rows. Output: the adjusted NEW row.
 */
create or replace function public.set_review_freshness()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_stale and new.is_stale and new.reviewer_id = auth.uid() then
    new.is_stale := false;
  end if;
  return new;
end;
$$;

create trigger set_review_freshness
  before update on public.reviews
  for each row execute function public.set_review_freshness();

create view public.review_votes
with (security_invoker = true)
as
select target_type, target_id, verdict, count(*)::integer as votes
from public.reviews
where not is_stale
group by target_type, target_id, verdict;

revoke all on public.review_votes from anon;
grant select on public.review_votes to authenticated, service_role;
