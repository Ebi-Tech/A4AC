import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { btnSecondary, h1, muted } from "@/components/ui";
import { ANCHOR_NAMES, loadContributeLanguages } from "@/lib/contribute";
import { createClient } from "@/lib/supabase/server";
import { WriteTask } from "./write-task";

export const metadata: Metadata = { title: "Write · A4AC" };

/**
 * WRITE task page. Checks that the user speaks this open language, loads the
 * first sentence from the queue on the server (so it shows without waiting
 * for JavaScript), then hands over to the interactive WriteTask.
 *
 * @param props.params Route parameter "language" (ISO 639-3 code).
 * @returns The write page, or a short explanation when the language is not available.
 */
export default async function WritePage({ params }: { params: Promise<{ language: string }> }) {
  const { language: iso } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/contribute/${encodeURIComponent(iso)}/write`);

  const languages = await loadContributeLanguages(supabase, user.id);
  const language = languages.find((l) => l.iso_code === iso);

  if (!language || language.iso_code === "eng") {
    return (
      <div className="space-y-4">
        <h1 className={h1}>Write</h1>
        <p>
          {language
            ? "English is the source language, so there is nothing to translate into it."
            : "You can only write in open languages that you listed as a language you speak."}
        </p>
        <Link href="/contribute" className={btnSecondary}>
          Back to contribute
        </Link>
      </div>
    );
  }

  const { data } = await supabase.rpc("next_sentence_for_write", { p_language_id: language.id });

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">Write in {language.name}</h1>
        <Link href="/contribute" className={`text-sm underline ${muted}`}>
          Done
        </Link>
      </div>
      <WriteTask
        language={{
          id: language.id,
          iso: language.iso_code,
          name: language.name,
          specialCharacters: language.special_characters,
        }}
        initial={data?.[0] ?? null}
        anchorNames={ANCHOR_NAMES}
      />
    </div>
  );
}
