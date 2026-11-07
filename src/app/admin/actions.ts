"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { loadBlocklist } from "@/lib/blocklist";
import type { FormState } from "@/lib/form-state";
import {
  checkSentence,
  difficultyFromWordCount,
  importSentences,
  normalizeText,
  SKIP_REASON_TEXT,
  wordCount,
  type ImportSummary,
} from "@/lib/sentence-import";

export type BulkUploadState = FormState & { summary?: ImportSummary };

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ISO_CODE = /^[a-z]{3}$/;

/**
 * Reads a trimmed string field from a form.
 *
 * @param formData The submitted form.
 * @param name     Field name.
 * @returns The trimmed value ("" when missing).
 */
function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/**
 * Turns a database error into a short message for admins.
 *
 * @param error The error returned by Supabase.
 * @returns A readable message.
 */
function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "That sentence is already in the bank.";
  return error.message;
}

/**
 * Validates the shared sentence fields used by "add" and "edit".
 *
 * @param formData Fields "text", "topic", "difficulty".
 * @returns Clean values, or an error message.
 */
async function sentenceFields(
  formData: FormData,
): Promise<{ text: string; topic: string | null; difficulty: number } | { error: string }> {
  const text = normalizeText(field(formData, "text"));
  const reason = checkSentence(text, await loadBlocklist());
  if (reason) return { error: `This sentence cannot be used: ${SKIP_REASON_TEXT[reason]}.` };

  const topic = normalizeText(field(formData, "topic")).toLowerCase().slice(0, 50) || null;
  const given = Number.parseInt(field(formData, "difficulty"), 10);
  const difficulty = given >= 1 && given <= 5 ? given : difficultyFromWordCount(wordCount(text));
  return { text, topic, difficulty };
}

/**
 * Adds one English sentence to the bank after the same checks as the import.
 *
 * @param _prev    Previous state (unused).
 * @param formData Fields "text", "topic", "difficulty", "source", "license".
 * @returns A success or error message.
 */
export async function addSentence(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const values = await sentenceFields(formData);
  if ("error" in values) return values;

  const license = field(formData, "license");
  const source = field(formData, "source") || "admin";
  if (!license) return { error: "A licence is required." };

  const { data: english } = await supabase.from("languages").select("id").eq("iso_code", "eng").single();
  if (!english) return { error: "English (eng) is missing from the languages table." };

  const { error } = await supabase
    .from("sentences")
    .insert({ ...values, anchor_language_id: english.id, source, source_license: license });
  if (error) return { error: dbMessage(error) };

  revalidatePath("/admin/sentences");
  return { success: `Added: “${values.text}”` };
}

/**
 * Saves edits to a sentence. The database refuses text changes for
 * sentences that already have contributions.
 *
 * @param _prev    Previous state (unused).
 * @param formData Fields "id", "text", "topic", "difficulty".
 * @returns A success or error message.
 */
export async function updateSentence(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const values = await sentenceFields(formData);
  if ("error" in values) return values;

  const { error } = await supabase.from("sentences").update(values).eq("id", field(formData, "id"));
  if (error) return { error: dbMessage(error) };

  revalidatePath("/admin/sentences");
  return { success: "Saved." };
}

/**
 * Activates or deactivates a sentence. Inactive sentences are never offered
 * to contributors.
 *
 * @param _prev    Previous state (unused).
 * @param formData Fields "id", "active" ("true" | "false").
 * @returns A success or error message.
 */
export async function setSentenceActive(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const active = field(formData, "active") === "true";
  const { error } = await supabase.from("sentences").update({ is_active: active }).eq("id", field(formData, "id"));
  if (error) return { error: dbMessage(error) };

  revalidatePath("/admin/sentences");
  return { success: active ? "Activated." : "Deactivated." };
}

/**
 * Permanently deletes a sentence. Only possible when nobody has contributed
 * to it yet; otherwise the database refuses and asks to deactivate instead.
 *
 * @param _prev    Previous state (unused).
 * @param formData Field "id".
 * @returns An error message, or redirects to the sentence list.
 */
export async function deleteSentence(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("sentences").delete().eq("id", field(formData, "id"));
  if (error) return { error: dbMessage(error) };

  revalidatePath("/admin/sentences");
  redirect("/admin/sentences?deleted=1");
}

/**
 * Imports an uploaded .txt / .csv / .tsv file with the same validation as
 * the import script.
 *
 * @param _prev    Previous state (unused).
 * @param formData Fields "file", "source", "license".
 * @returns The import summary, or an error.
 */
export async function bulkUpload(_prev: BulkUploadState, formData: FormData): Promise<BulkUploadState> {
  const { supabase } = await requireAdmin();
  const file = formData.get("file");
  const source = field(formData, "source");
  const license = field(formData, "license");

  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "The file is larger than 4 MB. Use the import script instead." };
  if (!/\.(txt|csv|tsv)$/i.test(file.name)) return { error: "Upload a .txt, .csv or .tsv file." };
  if (!license) return { error: "A licence is required." };
  if (!source) return { error: "A source is required." };

  try {
    const summary = await importSentences(supabase, await file.text(), {
      fileName: file.name,
      source,
      license,
      blocklist: await loadBlocklist(),
    });
    revalidatePath("/admin/sentences");
    return { success: `Imported ${summary.imported} of ${summary.total} lines.`, summary };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Upload failed." };
  }
}

/**
 * Adds a French version of a sentence written by the admin. It is stored as a
 * verified translation in "fra", so it immediately counts as an anchor.
 *
 * @param _prev    Previous state (unused).
 * @param formData Fields "sentence_id", "text".
 * @returns A success or error message.
 */
export async function addFrenchVersion(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requireAdmin();
  const text = normalizeText(field(formData, "text"));
  if (!text) return { error: "Enter the French text." };

  const { data: languages } = await supabase.from("languages").select("id, iso_code").in("iso_code", ["eng", "fra"]);
  const eng = languages?.find((l) => l.iso_code === "eng")?.id;
  const fra = languages?.find((l) => l.iso_code === "fra")?.id;
  if (!eng || !fra) return { error: "English or French is missing from the languages table." };

  const { error } = await supabase.from("translations").insert({
    sentence_id: field(formData, "sentence_id"),
    language_id: fra,
    seen_anchor_language_id: eng,
    contributor_id: userId,
    text,
    status: "verified",
  });
  if (error) return { error: dbMessage(error) };

  revalidatePath("/admin/anchors");
  return { success: "French version added and verified." };
}

/**
 * Sets the status of a French anchor translation (verify or reject).
 *
 * @param _prev    Previous state (unused).
 * @param formData Fields "translation_id", "status" ("verified" | "rejected").
 * @returns A success or error message.
 */
export async function setFrenchStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const status = field(formData, "status");
  if (status !== "verified" && status !== "rejected") return { error: "Unknown status." };

  const { data: fra } = await supabase.from("languages").select("id").eq("iso_code", "fra").single();
  const { error, count } = await supabase
    .from("translations")
    .update({ status }, { count: "exact" })
    .eq("id", field(formData, "translation_id"))
    .eq("language_id", fra?.id ?? "");
  if (error) return { error: dbMessage(error) };
  if (!count) return { error: "That French version was not found." };

  revalidatePath("/admin/anchors");
  return { success: status === "verified" ? "Verified." : "Rejected." };
}

/**
 * Approves a language request: creates the language (or reuses the existing
 * one with that code) and marks the request as added.
 *
 * @param _prev    Previous state (unused).
 * @param formData Fields "request_id", "iso_code", "name", "native_name", "status".
 * @returns A success or error message.
 */
export async function approveLanguageRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const isoCode = field(formData, "iso_code").toLowerCase();
  const name = field(formData, "name");
  const status = field(formData, "status") === "waiting_for_contributors" ? "waiting_for_contributors" : "open";
  if (!ISO_CODE.test(isoCode)) return { error: "Enter the 3-letter ISO 639-3 code, e.g. “lug”." };
  if (!name) return { error: "Enter the language name." };

  const { error } = await supabase.rpc("approve_language_request", {
    p_request_id: field(formData, "request_id"),
    p_iso_code: isoCode,
    p_name: name,
    p_native_name: field(formData, "native_name"),
    p_status: status,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/language-requests");
  revalidatePath("/languages");
  return { success: `${name} (${isoCode}) added.` };
}

/**
 * Declines a pending language request.
 *
 * @param _prev    Previous state (unused).
 * @param formData Field "request_id".
 * @returns A success or error message.
 */
export async function declineLanguageRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("decline_language_request", { p_request_id: field(formData, "request_id") });
  if (error) return { error: error.message };

  revalidatePath("/admin/language-requests");
  return { success: "Declined." };
}

/**
 * Resolves a sentence report: dismiss it, or deactivate the sentence (which
 * also closes every other open report on that sentence).
 *
 * @param _prev    Previous state (unused).
 * @param formData Fields "report_id", "action" ("dismiss" | "deactivate").
 * @returns A success or error message.
 */
export async function resolveReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const action = field(formData, "action");
  if (action !== "dismiss" && action !== "deactivate") return { error: "Unknown action." };

  const { error } = await supabase.rpc("resolve_sentence_report", {
    p_report_id: field(formData, "report_id"),
    p_action: action,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/reports");
  return { success: action === "dismiss" ? "Report dismissed." : "Sentence deactivated." };
}

/**
 * Saves a language's tap-to-insert characters and status.
 *
 * @param _prev    Previous state (unused).
 * @param formData Fields "id", "special_characters" (separated by spaces), "status".
 * @returns A success or error message.
 */
export async function updateLanguage(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const characters = [...new Set(field(formData, "special_characters").normalize("NFC").split(/\s+/).filter(Boolean))];
  if (characters.length > 40) return { error: "Please keep it to 40 characters or fewer." };
  if (characters.some((c) => [...c].length > 3)) return { error: "Separate each character with a space." };
  const status = field(formData, "status") === "waiting_for_contributors" ? "waiting_for_contributors" : "open";

  const { error } = await supabase
    .from("languages")
    .update({ special_characters: characters, status })
    .eq("id", field(formData, "id"));
  if (error) return { error: error.message };

  revalidatePath("/admin/languages");
  revalidatePath("/languages");
  return { success: "Saved." };
}
