import { updateLanguage } from "@/app/admin/actions";
import { ActionForm } from "@/components/action-form";
import { btnPrimary, card, h1, input, label, muted } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";

/**
 * Languages: edit the tap-to-insert characters shown under the text box and
 * whether the language is open for contributions.
 *
 * @returns The languages admin page.
 */
export default async function AdminLanguagesPage() {
  const { supabase } = await requireAdmin();
  const { data: languages } = await supabase
    .from("languages")
    .select("id, iso_code, name, native_name, is_anchor, status, special_characters")
    .order("is_anchor", { ascending: false })
    .order("name");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={h1}>Languages</h1>
        <p className={muted}>
          Special characters appear as buttons under the text box. Separate them with spaces, e.g. “ẹ ọ ṣ”.
        </p>
      </div>
      <ul className="space-y-3">
        {languages?.map((language) => (
          <li key={language.id} className={card}>
            <ActionForm action={updateLanguage} className="space-y-3">
              <input type="hidden" name="id" value={language.id} />
              <p className="text-lg font-semibold">
                {language.name}{" "}
                <span className={`text-sm font-normal ${muted}`}>
                  {language.iso_code}
                  {language.is_anchor ? " · source language" : ""}
                </span>
              </p>
              <div>
                <label htmlFor={`chars-${language.id}`} className={label}>
                  Special characters
                </label>
                <input
                  id={`chars-${language.id}`}
                  name="special_characters"
                  defaultValue={language.special_characters.join(" ")}
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className={`${input} text-lg`}
                />
              </div>
              <div>
                <label htmlFor={`status-${language.id}`} className={label}>
                  Status
                </label>
                <select id={`status-${language.id}`} name="status" defaultValue={language.status} className={input}>
                  <option value="open">Open</option>
                  <option value="waiting_for_contributors">Waiting for contributors</option>
                </select>
              </div>
              <button type="submit" className={btnPrimary}>
                Save
              </button>
            </ActionForm>
          </li>
        ))}
      </ul>
    </div>
  );
}
