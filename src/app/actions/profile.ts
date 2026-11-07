"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteAccountAndFiles } from "@/lib/account-deletion";
import { loadConsent } from "@/lib/consent";
import type { FormState } from "@/lib/form-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const EMAIL_LIKE = /[^@\s]+@[^@\s]+\.[^@\s]+/;
const ISO_CODE = /^[a-z]{3}$/;

type Ability = "native" | "fluent" | "understands";

/**
 * Returns a server Supabase client together with the signed-in user, or
 * redirects to /login when nobody is signed in.
 *
 * @returns The client and the user's id.
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
 * Records consent for the signed-in user. Both checkboxes are required, and
 * the version of the text the user saw must still be the current one.
 *
 * @param _prev    Previous form state (unused).
 * @param formData Fields: "version", "adult" ("on"), "agree" ("on").
 * @returns An error, or redirects to the next onboarding step.
 */
export async function acceptConsent(_prev: FormState, formData: FormData): Promise<FormState> {
  if (formData.get("adult") !== "on") return { error: "Please confirm that you are 18 or older." };
  if (formData.get("agree") !== "on") return { error: "Please tick “I agree” to continue." };

  const version = String(formData.get("version") ?? "");
  const consent = await loadConsent();
  if (version !== consent.version) {
    return { error: "The consent text has just changed. Please read it again." };
  }

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("accept_consent", { p_version: version, p_is_adult: true });
  if (error) return { error: error.message };

  redirect("/onboarding");
}

/**
 * Validates a display name. Blank means "keep the current name".
 *
 * @param raw The submitted value.
 * @returns The cleaned name (or null to keep the current one), or an error message.
 */
function cleanDisplayName(raw: string): { name: string | null } | { error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { name: null };
  if (name.length > 80) return { error: "Please use 80 characters or fewer." };
  if (EMAIL_LIKE.test(name)) return { error: "Please don't use an email address as your name. It would be shown publicly." };
  return { name };
}

/**
 * Saves the display name. During onboarding it then moves on to the
 * languages step; on the profile page it shows a confirmation.
 *
 * @param _prev    Previous form state (unused).
 * @param formData Fields: "display_name", "context" ("onboarding" | "profile").
 * @returns A message, or a redirect during onboarding.
 */
export async function saveDisplayName(_prev: FormState, formData: FormData): Promise<FormState> {
  const cleaned = cleanDisplayName(String(formData.get("display_name") ?? ""));
  if ("error" in cleaned) return { error: cleaned.error };

  const { supabase, userId } = await requireUser();
  if (cleaned.name) {
    const { error } = await supabase.from("profiles").update({ display_name: cleaned.name }).eq("id", userId);
    if (error) return { error: "We could not save your name. Please try again." };
  }

  if (formData.get("context") === "onboarding") redirect("/onboarding?step=languages");
  revalidatePath("/profile");
  return { success: cleaned.name ? "Name saved." : "Your name is unchanged." };
}

/**
 * Replaces the user's language list with what was submitted. Spoken languages
 * come from "speak:<language id>" = native | fluent; anchor languages ticked
 * under "understand:<language id>" are saved as "understands" unless already
 * spoken. At least one spoken language is required. During onboarding this
 * also marks onboarding as finished.
 *
 * @param _prev    Previous form state (unused).
 * @param formData Fields as above plus "context" ("onboarding" | "profile").
 * @returns A message, or a redirect to the home page after onboarding.
 */
export async function saveLanguages(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requireUser();

  const { data: languages, error: langError } = await supabase.from("languages").select("id, is_anchor");
  if (langError) return { error: "We could not load the language list. Please try again." };
  const anchors = new Set(languages.filter((l) => l.is_anchor).map((l) => l.id));
  const known = new Set(languages.map((l) => l.id));

  const chosen = new Map<string, Ability>();
  for (const [key, value] of formData.entries()) {
    const [kind, languageId] = key.split(":");
    if (!languageId || !known.has(languageId)) continue;
    if (kind === "speak" && (value === "native" || value === "fluent")) chosen.set(languageId, value);
  }
  for (const [key, value] of formData.entries()) {
    const [kind, languageId] = key.split(":");
    if (kind === "understand" && value === "on" && anchors.has(languageId) && !chosen.has(languageId)) {
      chosen.set(languageId, "understands");
    }
  }

  if (![...chosen.values()].some((a) => a !== "understands")) {
    return { error: "Please choose at least one language you can speak." };
  }

  const keep = [...chosen.keys()];
  const { error: deleteError } = await supabase
    .from("user_languages")
    .delete()
    .eq("user_id", userId)
    .not("language_id", "in", `(${keep.join(",")})`);
  if (deleteError) return { error: "We could not save your languages. Please try again." };

  const { error: upsertError } = await supabase.from("user_languages").upsert(
    keep.map((languageId) => ({ user_id: userId, language_id: languageId, ability: chosen.get(languageId)! })),
    { onConflict: "user_id,language_id" },
  );
  if (upsertError) return { error: "We could not save your languages. Please try again." };

  if (formData.get("context") === "onboarding") {
    const { error } = await supabase.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", userId);
    if (error) return { error: "We could not finish setting up your profile. Please try again." };
    redirect("/?welcome=1");
  }

  revalidatePath("/profile");
  return { success: "Languages saved." };
}

/**
 * Records a request for a language that is not in the list yet.
 *
 * @param _prev    Previous form state (unused).
 * @param formData Fields: "name" (required), "iso_code" (optional, 3 letters), "note" (optional).
 * @returns A thank-you message or an error.
 */
export async function requestLanguage(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const isoCode = String(formData.get("iso_code") ?? "").trim().toLowerCase();
  const note = String(formData.get("note") ?? "").trim();

  if (!name) return { error: "Please enter the name of the language." };
  if (name.length > 100) return { error: "Please use 100 characters or fewer for the name." };
  if (isoCode && !ISO_CODE.test(isoCode)) return { error: "The code should be 3 letters, like “ibo”. You can leave it empty." };
  if (note.length > 1000) return { error: "Please keep the note under 1000 characters." };

  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("language_requests")
    .insert({ requester_id: userId, name, iso_code: isoCode || null, note: note || null });
  if (error) return { error: "We could not send your request. Please try again." };

  return { success: `Thanks! We received your request for ${name}.` };
}

/**
 * Permanently deletes the signed-in user's account, their audio files and all
 * their contributions, then signs them out. The user must type DELETE.
 *
 * @param _prev    Previous form state (unused).
 * @param formData Fields: "confirm" (must be "DELETE").
 * @returns An error, or redirects to the home page.
 */
export async function deleteAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  if (String(formData.get("confirm") ?? "").trim() !== "DELETE") {
    return { error: "Type DELETE in capital letters to confirm." };
  }

  const { supabase, userId } = await requireUser();
  try {
    await deleteAccountAndFiles(createAdminClient(), userId);
  } catch {
    return { error: "Something went wrong and your account was not deleted. Please try again." };
  }

  await supabase.auth.signOut({ scope: "local" });
  redirect("/?account=deleted");
}
