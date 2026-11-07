import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const SKIP_REASONS = ["not_sure", "unclear", "report"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/**
 * Records a skip (or report) shared by the write and speak tasks. The
 * sentence is then not offered to this user in this language for the skip
 * cooldown; a "report" also creates a row on /admin/reports.
 *
 * @param supabase Server client acting as the user.
 * @param userId   The signed-in user's id.
 * @param input    sentenceId, languageId, reason, note (used for reports only).
 * @returns True when the skip was saved.
 */
export async function recordSkip(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { sentenceId: string; languageId: string; reason: SkipReason; note?: string },
): Promise<boolean> {
  if (!SKIP_REASONS.includes(input.reason)) return false;
  const note = input.reason === "report" ? (input.note ?? "").trim().slice(0, 500) : "";
  const { error } = await supabase.from("sentence_skips").insert({
    user_id: userId,
    sentence_id: input.sentenceId,
    language_id: input.languageId,
    reason: input.reason,
    note: note || null,
  });
  return !error;
}
