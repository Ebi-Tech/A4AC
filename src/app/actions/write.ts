"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";

export type QueueItem = {
  sentence_id: string;
  anchor_text: string;
  anchor_language_id: string;
  anchor_iso_code: string;
};

export type WriteResult =
  | { ok: true; following: QueueItem | null }
  | { ok: false; error: string; rule: string | null };

const GENERIC_ERROR = "Something went wrong. Please check your connection and try again.";
const SKIP_REASONS = ["not_sure", "unclear", "report"] as const;
type SkipReason = (typeof SKIP_REASONS)[number];

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
 * Asks the queue for the next sentence to write.
 *
 * @param supabase   Server client acting as the user.
 * @param languageId Target language.
 * @param exclude    Sentence ids not to return (on screen or prefetched).
 * @returns The next item, or null when nothing is available.
 */
async function queueNext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  languageId: string,
  exclude: string[],
): Promise<QueueItem | null> {
  const { data } = await supabase.rpc("next_sentence_for_write", {
    p_language_id: languageId,
    p_exclude: exclude.filter(Boolean),
  });
  return data?.[0] ?? null;
}

/**
 * Remembers the language chosen on /contribute (stored on the profile) and
 * reloads the hub.
 *
 * @param formData Field "language_id".
 * @returns Never returns normally; redirects to /contribute.
 */
export async function chooseLanguage(formData: FormData): Promise<void> {
  const { supabase, userId } = await requireUser();
  const languageId = String(formData.get("language_id") ?? "");
  if (languageId) {
    await supabase.from("profiles").update({ last_language_id: languageId }).eq("id", userId);
  }
  redirect("/contribute");
}

/**
 * Fetches the next sentence without submitting anything (used to prefetch
 * while the user types).
 *
 * @param languageId Target language.
 * @param exclude    Sentence ids to leave out.
 * @returns The next item, or null.
 */
export async function getNextSentence(languageId: string, exclude: string[]): Promise<QueueItem | null> {
  const { supabase } = await requireUser();
  return queueNext(supabase, languageId, exclude);
}

/**
 * Saves a translation and returns a further sentence to keep the prefetch
 * pipeline full. The database applies every rule (consent, language,
 * content, duplicates, rate limit) and its friendly message is passed back.
 *
 * @param input languageId, sentenceId, seenAnchorLanguageId, text, exclude
 *              (ids already on screen or prefetched).
 * @returns ok with the following item, or the error message and rule name.
 */
export async function submitTranslation(input: {
  languageId: string;
  sentenceId: string;
  seenAnchorLanguageId: string;
  text: string;
  exclude: string[];
}): Promise<WriteResult> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("translations").insert({
    sentence_id: input.sentenceId,
    language_id: input.languageId,
    seen_anchor_language_id: input.seenAnchorLanguageId,
    contributor_id: userId,
    text: input.text,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "You already translated this sentence. You can edit it from your profile.", rule: "duplicate" };
    }
    return { ok: false, error: error.hint ? error.message : GENERIC_ERROR, rule: error.hint ?? null };
  }

  return { ok: true, following: await queueNext(supabase, input.languageId, [...input.exclude, input.sentenceId]) };
}

/**
 * Records a skip (or a report) so the sentence is not offered again to this
 * user in this language for a while, and returns a further sentence.
 *
 * @param input languageId, sentenceId, reason ("not_sure" | "unclear" |
 *              "report"), note (optional, for reports), exclude.
 * @returns ok with the following item, or an error.
 */
export async function skipSentence(input: {
  languageId: string;
  sentenceId: string;
  reason: SkipReason;
  note?: string;
  exclude: string[];
}): Promise<WriteResult> {
  if (!SKIP_REASONS.includes(input.reason)) return { ok: false, error: GENERIC_ERROR, rule: null };
  const { supabase, userId } = await requireUser();
  const note = input.reason === "report" ? (input.note ?? "").trim().slice(0, 500) : "";

  const { error } = await supabase.from("sentence_skips").insert({
    user_id: userId,
    sentence_id: input.sentenceId,
    language_id: input.languageId,
    reason: input.reason,
    note: note || null,
  });
  if (error) return { ok: false, error: GENERIC_ERROR, rule: null };

  return { ok: true, following: await queueNext(supabase, input.languageId, [...input.exclude, input.sentenceId]) };
}

/**
 * Edits the text of one of the user's own translations from the profile
 * page. The database resets it to pending and marks old reviews stale.
 *
 * @param _prev    Previous state (unused).
 * @param formData Fields "id", "text".
 * @returns A success or error message.
 */
export async function updateMyTranslation(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requireUser();
  const { error, count } = await supabase
    .from("translations")
    .update({ text: String(formData.get("text") ?? "") }, { count: "exact" })
    .eq("id", String(formData.get("id") ?? ""))
    .eq("contributor_id", userId);

  if (error) return { error: error.hint ? error.message : GENERIC_ERROR };
  if (!count) return { error: "This translation can no longer be edited." };
  revalidatePath("/profile");
  return { success: "Saved. It will be reviewed again." };
}

/**
 * Deletes one of the user's own pending translations.
 *
 * @param _prev    Previous state (unused).
 * @param formData Field "id".
 * @returns A success or error message.
 */
export async function deleteMyTranslation(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requireUser();
  const { error, count } = await supabase
    .from("translations")
    .delete({ count: "exact" })
    .eq("id", String(formData.get("id") ?? ""))
    .eq("contributor_id", userId)
    .eq("status", "pending");

  if (error) return { error: GENERIC_ERROR };
  if (!count) return { error: "Only translations that are still pending can be deleted." };
  revalidatePath("/profile");
  return { success: "Deleted." };
}
