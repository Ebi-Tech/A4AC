import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { chooseLanguage } from "@/app/actions/write";
import { LanguageRequestForm } from "@/components/language-request-form";
import { btnSecondary, h1, h2, muted } from "@/components/ui";
import { loadContributeLanguages } from "@/lib/contribute";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Contribute · A4AC" };

const SOON = [
  { title: "Transcribe", text: "Type out what someone else said." },
  { title: "Review", text: "Check other people's work." },
];

const cardBase = "block rounded-2xl border p-5";

/**
 * Contribute hub. Lists the open languages the user speaks, remembers the
 * chosen one on their profile, and shows the tasks for it (only Write is
 * available so far). Explains what to do when no spoken language is open.
 *
 * @returns The hub page.
 */
export default async function ContributePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/contribute");

  const [languages, { data: profile }] = await Promise.all([
    loadContributeLanguages(supabase, user.id),
    supabase.from("profiles").select("last_language_id").eq("id", user.id).single(),
  ]);

  if (languages.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className={h1}>Contribute</h1>
        <p>
          None of the languages you speak is open for contributions yet. You can see which languages are open, add
          another language you speak on your profile, or ask us to add yours.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/languages" className={btnSecondary}>
            See open languages
          </Link>
          <Link href="/profile" className={btnSecondary}>
            Edit my languages
          </Link>
        </div>
        <LanguageRequestForm />
      </div>
    );
  }

  const selected = languages.find((l) => l.id === profile?.last_language_id) ?? languages[0];
  const canWrite = selected.iso_code !== "eng";

  return (
    <div className="space-y-8">
      <h1 className={h1}>Contribute</h1>

      <section aria-labelledby="language-heading" className="space-y-3">
        <h2 id="language-heading" className={h2}>
          Your language
        </h2>
        <form action={chooseLanguage} className="flex flex-wrap gap-2">
          {languages.map((language) => {
            const active = language.id === selected.id;
            return (
              <button
                key={language.id}
                type="submit"
                name="language_id"
                value={language.id}
                aria-pressed={active}
                data-language={language.iso_code}
                className={`min-h-12 rounded-xl border px-4 text-base font-medium ${
                  active
                    ? "border-emerald-700 bg-emerald-700 text-white"
                    : "border-stone-300 bg-white hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800"
                }`}
              >
                {language.name}
              </button>
            );
          })}
        </form>
      </section>

      <section aria-labelledby="tasks-heading" className="space-y-3">
        <h2 id="tasks-heading" className={h2}>
          What would you like to do?
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          <li>
            {canWrite ? (
              <Link
                href={`/contribute/${selected.iso_code}/write`}
                className={`${cardBase} border-emerald-700 bg-white hover:bg-emerald-50 dark:bg-stone-900 dark:hover:bg-emerald-950`}
              >
                <span className="block text-lg font-semibold">Write</span>
                <span className={`block text-sm ${muted}`}>Translate short sentences into {selected.name}.</span>
              </Link>
            ) : (
              <div className={`${cardBase} border-stone-200 dark:border-stone-800`} aria-disabled="true">
                <span className="block text-lg font-semibold">Write</span>
                <span className={`block text-sm ${muted}`}>
                  English is the source language, so there is nothing to translate into it.
                </span>
              </div>
            )}
          </li>
          <li>
            {canWrite ? (
              <Link
                href={`/contribute/${selected.iso_code}/speak`}
                className={`${cardBase} border-emerald-700 bg-white hover:bg-emerald-50 dark:bg-stone-900 dark:hover:bg-emerald-950`}
              >
                <span className="block text-lg font-semibold">Speak</span>
                <span className={`block text-sm ${muted}`}>Record yourself saying short sentences in {selected.name}.</span>
              </Link>
            ) : (
              <div className={`${cardBase} border-stone-200 dark:border-stone-800`} aria-disabled="true">
                <span className="block text-lg font-semibold">Speak</span>
                <span className={`block text-sm ${muted}`}>We are not collecting English recordings yet.</span>
              </div>
            )}
          </li>
          {SOON.map((task) => (
            <li key={task.title}>
              <div className={`${cardBase} border-stone-200 opacity-70 dark:border-stone-800`} aria-disabled="true">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-lg font-semibold">{task.title}</span>
                  <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium dark:bg-stone-800">
                    Coming soon
                  </span>
                </span>
                <span className={`block text-sm ${muted}`}>{task.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
