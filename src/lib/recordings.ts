import type { SupabaseClient } from "@supabase/supabase-js";

export const RECORDINGS_BUCKET = "recordings";
const PAGE_SIZE = 1000;

export type StoredFile = { path: string; createdAt: string | null };

const EXTENSIONS: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" };

/**
 * Strips codec parameters from a MIME type: "audio/webm;codecs=opus" → "audio/webm".
 *
 * @param mimeType The type reported by MediaRecorder.
 * @returns The base type in lower case.
 */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

/**
 * Picks the file extension for a recording's MIME type.
 *
 * @param mimeType The type reported by MediaRecorder.
 * @returns "webm", "ogg" or "m4a", or null for types the bucket does not accept.
 */
export function extensionForMimeType(mimeType: string): string | null {
  return EXTENSIONS[baseMimeType(mimeType)] ?? null;
}

/**
 * Lists every file under a folder of the recordings bucket, walking into
 * sub-folders (storage "list" is not recursive).
 *
 * @param client A Supabase client allowed to list the folder.
 * @param folder Folder path without a trailing slash ("" for the bucket root).
 * @returns Every file's full path and creation time.
 */
export async function listFilesRecursively(client: SupabaseClient, folder: string): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.storage.from(RECORDINGS_BUCKET).list(folder, { limit: PAGE_SIZE, offset });
    if (error) throw new Error(`Could not list ${folder || "bucket"}: ${error.message}`);

    for (const entry of data) {
      const fullPath = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.id === null) {
        files.push(...(await listFilesRecursively(client, fullPath)));
      } else {
        files.push({ path: fullPath, createdAt: entry.created_at ?? null });
      }
    }
    if (data.length < PAGE_SIZE) return files;
  }
}

/**
 * Removes audio files from the recordings bucket in batches.
 *
 * @param client A Supabase client allowed to delete the files.
 * @param paths  Object paths to remove.
 * @returns The number of paths sent for removal.
 */
export async function removeRecordingFiles(client: SupabaseClient, paths: string[]): Promise<number> {
  for (let i = 0; i < paths.length; i += PAGE_SIZE) {
    const { error } = await client.storage.from(RECORDINGS_BUCKET).remove(paths.slice(i, i + PAGE_SIZE));
    if (error) throw new Error(`Could not delete audio files: ${error.message}`);
  }
  return paths.length;
}

/**
 * Deletes a recording row and then its audio file. The row goes first so a
 * user can never be left with a row pointing at a missing file; if removing
 * the file fails, cleanup-orphans removes it later.
 *
 * @param client      A client allowed to delete the row (owner while pending, admin, or service role).
 * @param recordingId The recording's id.
 * @returns True when a row was deleted.
 */
export async function deleteRecordingWithFile(client: SupabaseClient, recordingId: string): Promise<boolean> {
  const { data, error } = await client.from("recordings").delete().eq("id", recordingId).select("storage_path");
  if (error) throw new Error(error.message);
  if (!data?.length) return false;
  await removeRecordingFiles(client, data.map((row) => row.storage_path as string)).catch(() => {});
  return true;
}
