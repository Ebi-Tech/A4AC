import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { supabaseServiceRoleKey, supabaseUrl } from "./env";

export const RECORDINGS_BUCKET = "recordings";

/**
 * Creates a Supabase client authenticated with the service role key.
 * It bypasses Row Level Security, so use it only in trusted server code
 * after you have checked what the current user is allowed to do.
 *
 * @returns A service-role Supabase client with session persistence disabled.
 */
export function createAdminClient() {
  return createClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Creates a short-lived signed URL so a reviewer or transcriber can play a
 * recording they do not own. The bucket is private, so this is the only way
 * non-owners get audio.
 *
 * @param storagePath    Path inside the "recordings" bucket (recordings.storage_path).
 * @param expiresInSecs  How long the link stays valid. Defaults to 10 minutes.
 * @returns The signed URL string.
 */
export async function createRecordingSignedUrl(storagePath: string, expiresInSecs = 600): Promise<string> {
  const { data, error } = await createAdminClient()
    .storage.from(RECORDINGS_BUCKET)
    .createSignedUrl(storagePath, expiresInSecs);

  if (error || !data) {
    throw new Error(`Could not sign recording URL: ${error?.message ?? "unknown error"}`);
  }
  return data.signedUrl;
}
