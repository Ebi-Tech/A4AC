import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSpeakItem, type SpeakMode } from "@/app/actions/speak";
import { btnSecondary, h1 } from "@/components/ui";
import { ANCHOR_NAMES, loadContributeLanguages } from "@/lib/contribute";
import { createClient } from "@/lib/supabase/server";
import { SpeakTask } from "./speak-task";

export const metadata: Metadata = { title: "Speak · A4AC" };

/**
 * SPEAK task page. Checks that the user speaks this open language, loads the
 * recording limits and the first item for the chosen mode on the server,
 * then hands over to the interactive SpeakTask.
 *
 * @param props.params       Route parameter "language" (ISO 639-3 code).
 * @param props.searchParams "mode" = "read" for read-aloud (default: translate and speak).
 * @returns The speak page, or a short explanation when the language is not available.
 */
export default async function SpeakPage({
  params,
  searchParams,
}: {
  params: Promise<{ language: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const [{ language: iso }, { mode: modeParam }] = await Promise.all([params, searchParams]);
  const mode: SpeakMode = modeParam === "read" ? "read" : "translate";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/contribute/${encodeURIComponent(iso)}/speak`);

  const languages = await loadContributeLanguages(supabase, user.id);
  const language = languages.find((l) => l.iso_code === iso);

  if (!language || language.iso_code === "eng") {
    return (
      <div className="space-y-4">
        <h1 className={h1}>Speak</h1>
        <p>
          {language
            ? "English is the source language, so we are not collecting English recordings yet."
            : "You can only record in open languages that you listed as a language you speak."}
        </p>
        <Link href="/contribute" className={btnSecondary}>
          Back to contribute
        </Link>
      </div>
    );
  }

  const [initial, { data: settings }] = await Promise.all([
    getSpeakItem(language.id, mode, []),
    supabase.from("app_settings").select("recording_min_ms, recording_max_ms, recording_min_speech_ms").single(),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{`Speak in ${language.name}`}</h1>
      <SpeakTask
        language={{ id: language.id, iso: language.iso_code, name: language.name }}
        initialMode={mode}
        initial={initial}
        limits={{
          minMs: settings?.recording_min_ms ?? 1000,
          maxMs: settings?.recording_max_ms ?? 15000,
          minSpeechMs: settings?.recording_min_speech_ms ?? 500,
        }}
        anchorNames={ANCHOR_NAMES}
      />
    </div>
  );
}
