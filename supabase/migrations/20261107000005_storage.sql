-- =============================================================================
-- 05 · Storage bucket for audio
--
-- Creates the private "recordings" bucket (audio only, 10 MB per file).
-- Object paths must look like  <user_id>/<anything>.  Policies:
--   upload   signed-in users, only into their own <user_id>/ folder
--   read     the owner and admins (needed to create signed URLs from the
--            browser). Anyone else gets audio through signed URLs minted on
--            the server with the service role (src/lib/supabase/admin.ts).
--   delete   the owner (to discard a pending recording) and admins
--   update   nobody: audio is never overwritten
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings',
  'recordings',
  false,
  10485760,
  array['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/aac']
)
on conflict (id) do nothing;

create policy "recordings bucket: upload into own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "recordings bucket: owner or admin read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'recordings'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

create policy "recordings bucket: owner or admin delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'recordings'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );
