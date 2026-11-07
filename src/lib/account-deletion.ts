import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "recordings";
const PAGE_SIZE = 1000;

/**
 * Lists every file under a folder of the recordings bucket, walking into
 * sub-folders. Storage "list" is not recursive, so folders are visited one by one.
 *
 * @param admin  A service-role Supabase client.
 * @param folder Folder path without a trailing slash, e.g. a user id.
 * @returns Full object paths of every file found.
 */
async function listFilesRecursively(admin: SupabaseClient, folder: string): Promise<string[]> {
  const files: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit: PAGE_SIZE, offset });
    if (error) throw new Error(`Could not list ${folder}: ${error.message}`);

    for (const entry of data) {
      const fullPath = `${folder}/${entry.name}`;
      if (entry.id === null) {
        files.push(...(await listFilesRecursively(admin, fullPath)));
      } else {
        files.push(fullPath);
      }
    }
    if (data.length < PAGE_SIZE) return files;
  }
}

/**
 * Permanently deletes a user: first every audio file in their folder of the
 * recordings bucket, then the auth user. Deleting the auth user cascades to
 * the profile and all rows they created. Files go first so a failure never
 * leaves orphaned audio behind for a user who no longer exists.
 *
 * @param admin  A service-role Supabase client (server only).
 * @param userId The id of the user to delete.
 * @returns How many audio files were removed.
 */
export async function deleteAccountAndFiles(admin: SupabaseClient, userId: string): Promise<{ filesRemoved: number }> {
  const files = await listFilesRecursively(admin, userId);

  for (let i = 0; i < files.length; i += PAGE_SIZE) {
    const { error } = await admin.storage.from(BUCKET).remove(files.slice(i, i + PAGE_SIZE));
    if (error) throw new Error(`Could not delete audio files: ${error.message}`);
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`Could not delete account: ${error.message}`);

  return { filesRemoved: files.length };
}
