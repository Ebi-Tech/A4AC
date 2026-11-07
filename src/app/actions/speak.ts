"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { deleteRecordingWithFile, extensionForMimeType, RECORDINGS_BUCKET, baseMimeType } from "@/lib/recordings";
import { recordSkip, type SkipReason } from "@/lib/skips";
import { createClient } from "@/lib/supabase/server";

export type SpeakMode = "translate" | "read";

export type SpeakItem =
  | { mode: "translate"; sentence_id: string; text: string; anchor_language_id: string; anchor_iso_code: string }
  | { mode: "read"; sentence_id: string; text: string; translation_id: string };

export type PreparedUpload = { ok: true; path: string; signedUrl: string; contentType: string } | { ok: false; error: string };

export type FinalizeResult = { ok: true } | { ok: false; error: string; rule: string | null; retry: boolean };

const GENERIC_ERROR = "Something went wrong. Please check your connection and try again.";
const MAX_CHECK_JSON = 2000;

type Server = Awaited<ReturnType<typeof createClient>>;

/**
 * Returns a server Supabase client and the signed-in user's id, or redirects
 * to /login when nobody is signed in.
 *
 * @returns The client and user id.
 */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

/**
 * Asks the right queue for the next item in the chosen mode.
 *
 * @param supabase   Server client acting as the user.
 * @param languageId Target language.
 * @param mode       "translate" (anchor sentence) or "read" (existing translation).
 * @param exclude    Sentence ids to leave out (on screen, prefetched or uploading).
 * @returns The next item, or null when nothing is available.
 */
async function nextItem(supabase: Server, languageId: string, mode: SpeakMode, exclude: string[]): Promise<SpeakItem | null> {
  const ids = exclude.filter(Boolean);
  if (mode === "read") {
    const { data } = await supabase.rpc("next_translation_for_read_aloud", { p_language_id: languageId, p_exclude: ids });
    const row = data?.[0];
    return row ? { mode: "read", sentence_id: row.sentence_id, text: row.text, translation_id: row.translation_id } : null;
  }
  const { data } = await supabase.rpc("next_sentence_for_speak", { p_language_id: languageId, p_exclude: ids });
  const row = data?.[0];
  return row
    ? {
        mode: "translate",
        sentence_id: row.sentence_id,
        text: row.anchor_text,
        anchor_language_id: row.anchor_language_id,
        anchor_iso_code: row.anchor_iso_code,
      }
    : null;
}

/**
 * Loads the first item for a mode (used by the page and when switching modes).
 *
 * @param languageId Target language.
 * @param mode       Speak mode.
 * @param exclude    Sentence ids to leave out.
 * @returns The next item, or null.
 */
export async function getSpeakItem(languageId: string, mode: SpeakMode, exclude: string[]): Promise<SpeakItem | null> {
  const { supabase } = await requireUser();
  return nextItem(supabase, languageId, mode === "read" ? "read" : "translate", exclude);
}

/**
 * Creates a short-lived signed upload URL for a new audio file in the user's
 * own folder. The URL is created as the user, so the bucket's folder rule is
 * checked; the bucket itself enforces size and type.
 *
 * @param mimeType The type MediaRecorder produced.
 * @returns The object path, the signed URL and the Content-Type to send, or an error.
 */
export async function prepareUpload(mimeType: string): Promise<PreparedUpload> {
  const { supabase, userId } = await requireUser();
  const extension = extensionForMimeType(mimeType);
  if (!extension) return { ok: false, error: "This browser records in a format we cannot store. Please try Chrome or Safari." };

  const path = `${userId}/${randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: GENERIC_ERROR };
  return { ok: true, path, signedUrl: data.signedUrl, contentType: baseMimeType(mimeType) };
}

/**
 * Keeps only plain values from the client's quality-check result, marks it as
 * coming from the client and limits its size.
 *
 * @param checks Whatever the client sent.
 * @returns A small JSON object for auto_check_result.
 */
function cleanChecks(checks: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (checks && typeof checks === "object") {
    for (const [key, value] of Object.entries(checks as Record<string, unknown>)) {
      if (["number", "boolean", "string"].includes(typeof value) || Array.isArray(value)) out[key] = value;
    }
  }
  out.source = "client";
  return JSON.stringify(out).length > MAX_CHECK_JSON ? { source: "client", truncated: true } : out;
}

/**
 * Creates the recordings row for an audio file the browser has just
 * uploaded. Confirms the file exists in the user's own folder first; if the
 * row cannot be created, the file is deleted again.
 *
 * @param input languageId, item (what was recorded), path, mimeType,
 *              durationMs, checks (client quality-check result).
 * @returns ok, or an error with its rule name and whether retrying could help.
 */
export async function finalizeRecording(input: {
  languageId: string;
  item: SpeakItem;
  path: string;
  mimeType: string;
  durationMs: number;
  checks: unknown;
}): Promise<FinalizeResult> {
  const { supabase, userId } = await requireUser();
  const fileName = input.path.split("/").pop() ?? "";
  if (!input.path.startsWith(`${userId}/`) || input.path.split("/").length !== 2 || !fileName) {
    return { ok: false, error: GENERIC_ERROR, rule: "no_file", retry: false };
  }

  const { data: listed } = await supabase.storage.from(RECORDINGS_BUCKET).list(userId, { search: fileName, limit: 5 });
  if (!listed?.some((entry) => entry.name === fileName)) {
    return { ok: false, error: "Your recording did not arrive. We will try sending it again.", rule: "no_file", retry: true };
  }

  const read = input.item.mode === "read";
  const { error } = await supabase.from("recordings").insert({
    sentence_id: input.item.sentence_id,
    language_id: input.languageId,
    contributor_id: userId,
    mode: read ? "read_aloud" : "translate_and_speak",
    translation_id: input.item.mode === "read" ? input.item.translation_id : null,
    seen_anchor_language_id: input.item.mode === "translate" ? input.item.anchor_language_id : null,
    storage_path: input.path,
    mime_type: input.mimeType.slice(0, 100),
    duration_ms: Math.round(input.durationMs),
    auto_check_result: cleanChecks(input.checks) as never,
  });

  if (error) {
    await supabase.storage.from(RECORDINGS_BUCKET).remove([input.path]);
    if (error.code === "23505") {
      return { ok: false, error: "You already recorded this sentence. Thank you!", rule: "duplicate", retry: false };
    }
    return error.hint
      ? { ok: false, error: error.message, rule: error.hint, retry: false }
      : { ok: false, error: GENERIC_ERROR, rule: null, retry: true };
  }
  return { ok: true };
}

/**
 * Skips (or reports) the item on screen and returns the next one in the same mode.
 *
 * @param input languageId, mode, sentenceId, reason, note, exclude.
 * @returns ok with the following item, or an error.
 */
export async function skipSpeak(input: {
  languageId: string;
  mode: SpeakMode;
  sentenceId: string;
  reason: SkipReason;
  note?: string;
  exclude: string[];
}): Promise<{ ok: true; following: SpeakItem | null } | { ok: false; error: string }> {
  const { supabase, userId } = await requireUser();
  const saved = await recordSkip(supabase, userId, input);
  if (!saved) return { ok: false, error: GENERIC_ERROR };
  return { ok: true, following: await nextItem(supabase, input.languageId, input.mode, [...input.exclude, input.sentenceId]) };
}

/**
 * Creates a five-minute signed URL so the owner can play one of their
 * recordings. Only called when they tap play.
 *
 * @param recordingId The recording's id.
 * @returns The URL, or null when the recording is not theirs or missing.
 */
export async function getPlaybackUrl(recordingId: string): Promise<string | null> {
  const { supabase, userId } = await requireUser();
  const { data: row } = await supabase
    .from("recordings")
    .select("storage_path")
    .eq("id", recordingId)
    .eq("contributor_id", userId)
    .maybeSingle();
  if (!row) return null;
  const { data } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(row.storage_path, 300);
  return data?.signedUrl ?? null;
}

/**
 * Deletes one of the user's own pending recordings and its audio file.
 *
 * @param _prev    Previous state (unused).
 * @param formData Field "id".
 * @returns A success or error message.
 */
export async function deleteMyRecording(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireUser();
  try {
    const deleted = await deleteRecordingWithFile(supabase, String(formData.get("id") ?? ""));
    if (!deleted) return { error: "Only recordings that are still pending can be deleted." };
  } catch {
    return { error: GENERIC_ERROR };
  }
  revalidatePath("/profile");
  return { success: "Deleted." };
}
