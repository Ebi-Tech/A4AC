import type { SupabaseClient } from "@supabase/supabase-js";
import { listFilesRecursively, removeRecordingFiles } from "./recordings";

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
  await removeRecordingFiles(admin, files.map((f) => f.path));

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`Could not delete account: ${error.message}`);

  return { filesRemoved: files.length };
}
