import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type Ability = Database["public"]["Enums"]["language_ability"];

export type PickerLanguage = {
  id: string;
  iso_code: string;
  name: string;
  native_name: string | null;
  is_anchor: boolean;
};

/**
 * Loads every language plus the signed-in user's current choices, for the
 * language picker used in onboarding and on the profile page.
 *
 * @param supabase A server client acting as the user.
 * @param userId   The signed-in user's id.
 * @returns The languages sorted by name and a map of language id to ability.
 */
export async function loadLanguagePicker(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ languages: PickerLanguage[]; selected: Record<string, Ability> }> {
  const [languagesResult, mineResult] = await Promise.all([
    supabase.from("languages").select("id, iso_code, name, native_name, is_anchor").order("name"),
    supabase.from("user_languages").select("language_id, ability").eq("user_id", userId),
  ]);

  if (languagesResult.error) throw new Error(languagesResult.error.message);
  if (mineResult.error) throw new Error(mineResult.error.message);

  const selected: Record<string, Ability> = {};
  for (const row of mineResult.data) selected[row.language_id] = row.ability;

  return { languages: languagesResult.data, selected };
}
