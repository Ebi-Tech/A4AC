"use client";

import { useActionState, useId, useState } from "react";
import { saveLanguages } from "@/app/actions/profile";
import { FormMessage } from "@/components/form-message";
import { btnPrimary, h2, input, label, muted } from "@/components/ui";
import { initialFormState } from "@/lib/form-state";
import type { Ability, PickerLanguage } from "@/lib/languages";

type Spoken = "" | "fluent" | "native";

const SPOKEN_OPTIONS: { value: Spoken; text: string }[] = [
  { value: "", text: "No" },
  { value: "fluent", text: "Fluent" },
  { value: "native", text: "Native" },
];

/**
 * Lower-cases and strips accents so "Yorùbá" matches a search for "yoruba".
 *
 * @param text Any text.
 * @returns The normalised text.
 */
function normalise(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * The language form used in onboarding and on the profile page. Users mark
 * each language they speak as fluent or native (searchable list), and tick the
 * anchor languages (English, French) they read and understand well.
 *
 * @param props.languages All languages.
 * @param props.selected  The user's current choices (language id to ability).
 * @param props.context   "onboarding" (button finishes onboarding) or "profile".
 * @returns The form.
 */
export function LanguagesForm({
  languages,
  selected,
  context,
}: {
  languages: PickerLanguage[];
  selected: Record<string, Ability>;
  context: "onboarding" | "profile";
}) {
  const [state, action, pending] = useActionState(saveLanguages, initialFormState);
  const [query, setQuery] = useState("");
  const [spoken, setSpoken] = useState<Record<string, Spoken>>(() =>
    Object.fromEntries(
      Object.entries(selected).map(([id, ability]) => [id, ability === "understands" ? "" : ability]),
    ),
  );
  const searchId = useId();
  const anchors = languages.filter((l) => l.is_anchor);
  const q = normalise(query.trim());

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="context" value={context} />

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className={h2}>Which languages can you speak?</h2>
          <p className={muted}>Choose at least one.</p>
        </div>

        <div>
          <label htmlFor={searchId} className={label}>
            Search languages
          </label>
          <input
            id={searchId}
            type="search"
            className={input}
            placeholder="e.g. Igbo"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <ul className="space-y-3">
          {languages.map((language) => {
            const matches =
              !q ||
              normalise(`${language.name} ${language.native_name ?? ""} ${language.iso_code}`).includes(q) ||
              Boolean(spoken[language.id]);
            return (
              <li key={language.id} hidden={!matches}>
                <fieldset className="rounded-2xl border border-stone-200 p-4 dark:border-stone-800">
                  <legend className="sr-only">{language.name}</legend>
                  <p className="mb-3 font-medium" aria-hidden="true">
                    {language.name}
                    {language.native_name && language.native_name !== language.name && (
                      <span className={`ml-2 font-normal ${muted}`}>{language.native_name}</span>
                    )}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {SPOKEN_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-stone-300 text-base font-medium has-checked:border-emerald-700 has-checked:bg-emerald-700 has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-emerald-700 dark:border-stone-700"
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={`speak:${language.id}`}
                          value={option.value}
                          checked={(spoken[language.id] ?? "") === option.value}
                          onChange={() => setSpoken((s) => ({ ...s, [language.id]: option.value }))}
                        />
                        {option.text}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ul>
        {q && languages.every((l) => !normalise(`${l.name} ${l.native_name ?? ""} ${l.iso_code}`).includes(q)) && (
          <p className={muted}>No language matches “{query}”. You can ask us to add it below.</p>
        )}
      </section>

      {anchors.length > 0 && (
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className={h2}>Which of these can you read and understand well?</h2>
            <p className={muted}>You will translate from these languages.</p>
          </div>
          <ul className="space-y-3">
            {anchors.map((language) => {
              const speaks = Boolean(spoken[language.id]);
              return (
                <li key={language.id}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-stone-200 px-4 py-3 has-checked:border-emerald-700 dark:border-stone-800">
                    <input
                      type="checkbox"
                      name={`understand:${language.id}`}
                      className="size-6 accent-emerald-700"
                      defaultChecked={selected[language.id] === "understands" || speaks}
                      disabled={speaks}
                    />
                    <span className="font-medium">{language.name}</span>
                    {speaks && <span className={`ml-auto text-sm ${muted}`}>You speak it</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <FormMessage state={state} />
      <button type="submit" className={btnPrimary} disabled={pending}>
        {pending ? "Saving…" : context === "onboarding" ? "Finish" : "Save languages"}
      </button>
    </form>
  );
}
