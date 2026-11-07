-- =============================================================================
-- 01 · Enums and generic helper functions
--
-- Creates every enum used by the schema and the helper functions that later
-- migrations rely on:
--   set_updated_at()   keeps updated_at current on every UPDATE
--   (is_admin and is_privileged are defined in 02, after profiles exists)
--
-- Shared status for translations, recordings and transcripts:
--   pending     newly submitted or re-submitted after an edit, awaiting review
--   unverified  has been reviewed but has not yet reached agreement
--   verified    independent reviewers agree it is correct
--   rejected    kept in the database, excluded from exports
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create type public.app_role            as enum ('contributor', 'admin');
create type public.language_status     as enum ('open', 'waiting_for_contributors');
create type public.language_ability    as enum ('native', 'fluent', 'understands');
create type public.contribution_status as enum ('pending', 'unverified', 'verified', 'rejected');
create type public.recording_mode      as enum ('translate_and_speak', 'read_aloud');
create type public.target_type         as enum ('translation', 'recording', 'transcript');
create type public.review_verdict      as enum (
  'same_meaning', 'mostly_same', 'different_meaning', 'unclear_audio', 'not_this_language'
);
create type public.flag_status         as enum ('open', 'confirmed', 'dismissed');

/**
 * set_updated_at
 * Trigger function. Stamps NEW.updated_at with the current time on every UPDATE.
 * Input: the row being updated. Output: the same row with updated_at = now().
 */
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
