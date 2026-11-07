import type { Metadata } from "next";
import { h1, muted } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Languages · A4AC" };

const STATUS_TEXT = {
  open: "Open",
  waiting_for_contributors: "Waiting for contributors",
} as const;

const numberFormat = new Intl.NumberFormat("en");

/**
 * Public list of every language with its status and simple counts. Counts
 * come from the language_stats() database function, so no contribution rows
 * are loaded.
 *
 * @returns The languages page.
 */
export default async function LanguagesPage() {
  const supabase = await createClient();
  const { data: languages, error } = await supabase.rpc("language_stats");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className={h1}>Languages</h1>
        <p className={muted}>
          English and French are the source languages. Everyone translates the same sentences, so every language can
          be paired with every other.
        </p>
      </div>

      {error && <p role="alert">We could not load the languages right now. Please try again later.</p>}

      <ul className="space-y-3">
        {languages?.map((language) => (
          <li
            key={language.language_id}
            className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {language.name}
                {language.native_name && language.native_name !== language.name && (
                  <span className={`ml-2 text-base font-normal ${muted}`}>{language.native_name}</span>
                )}
              </h2>
              <span
                className={
                  language.is_anchor
                    ? "rounded-full bg-stone-200 px-3 py-1 text-sm font-medium dark:bg-stone-800"
                    : language.status === "open"
                      ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                      : "rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                }
              >
                {language.is_anchor ? "Source language" : STATUS_TEXT[language.status]}
              </span>
            </div>
            {!language.is_anchor && (
              <dl className={`mt-3 grid grid-cols-3 gap-2 text-sm ${muted}`}>
                <div>
                  <dt>Translations</dt>
                  <dd className="text-base font-semibold text-stone-900 tabular-nums dark:text-stone-100">
                    {numberFormat.format(language.translations)}
                  </dd>
                </div>
                <div>
                  <dt>Recordings</dt>
                  <dd className="text-base font-semibold text-stone-900 tabular-nums dark:text-stone-100">
                    {numberFormat.format(language.recordings)}
                  </dd>
                </div>
                <div>
                  <dt>Contributors</dt>
                  <dd className="text-base font-semibold text-stone-900 tabular-nums dark:text-stone-100">
                    {numberFormat.format(language.contributors)}
                  </dd>
                </div>
              </dl>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
