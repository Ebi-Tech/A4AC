import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type ContributeLanguage = {
  id: string;
  iso_code: string;
  name: string;
  native_name: string | null;
  is_anchor: boolean;
  special_characters: string[];
};

export const ANCHOR_NAMES: Record<string, string> = { eng: "English", fra: "French" };

/**
 * Lists the open languages the user speaks (native or fluent), sorted by name.
 * These are the languages they can contribute in.
 *
 * @param supabase A server client acting as the user.
 * @param userId   The signed-in user's id.
 * @returns The languages, possibly empty.
 */
export async function loadContributeLanguages(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<ContributeLanguage[]> {
  const { data, error } = await supabase
    .from("user_languages")
    .select("ability, languages!inner(id, iso_code, name, native_name, is_anchor, special_characters, status)")
    .eq("user_id", userId)
    .in("ability", ["native", "fluent"])
    .eq("languages.status", "open");
  if (error) throw new Error(error.message);

  return data
    .map(({ languages: l }) => ({
      id: l.id,
      iso_code: l.iso_code,
      name: l.name,
      native_name: l.native_name,
      is_anchor: l.is_anchor,
      special_characters: l.special_characters,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
