import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteSentence, setSentenceActive, updateSentence } from "@/app/admin/actions";
import { ActionForm } from "@/components/action-form";
import { btnDanger, btnPrimary, btnSecondary, h1, h2, input, label, muted } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";

/**
 * Edit one sentence: text (only while nobody has contributed), topic,
 * difficulty, active state, and delete (only while unused).
 *
 * @param props.params Route parameter "id".
 * @returns The edit page, or 404 for an unknown id.
 */
export default async function EditSentencePage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdmin();
  const { id } = await params;

  const { data: sentence } = await supabase
    .from("sentences")
    .select("id, text, topic, difficulty, is_active, source, source_license, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!sentence) notFound();

  const { data: usage } = await supabase.rpc("admin_sentence_usage", { p_ids: [id] });
  const translations = usage?.[0]?.translations ?? 0;
  const recordings = usage?.[0]?.recordings ?? 0;
  const used = translations + recordings > 0;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href="/admin/sentences" className={`text-sm underline ${muted}`}>
          ← All sentences
        </Link>
        <h1 className={h1}>Edit sentence</h1>
        <p className={`text-sm ${muted}`}>
          {sentence.source} · {sentence.source_license} · {translations} translations, {recordings} recordings
          {!sentence.is_active && " · inactive"}
        </p>
      </div>

      <ActionForm action={updateSentence} className="space-y-4">
        <input type="hidden" name="id" value={sentence.id} />
        <div>
          <label htmlFor="text" className={label}>
            English sentence
          </label>
          {used ? (
            <>
              <input type="hidden" name="text" value={sentence.text} />
              <p className="rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-800">{sentence.text}</p>
              <p className={`mt-1 text-sm ${muted}`}>
                People have already contributed to this sentence, so its text is locked. Deactivate it and add a
                corrected sentence instead.
              </p>
            </>
          ) : (
            <input id="text" name="text" required defaultValue={sentence.text} className={input} />
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="topic" className={label}>
              Topic
            </label>
            <input id="topic" name="topic" defaultValue={sentence.topic ?? ""} className={input} />
          </div>
          <div>
            <label htmlFor="difficulty" className={label}>
              Difficulty
            </label>
            <select id="difficulty" name="difficulty" defaultValue={String(sentence.difficulty ?? "")} className={input}>
              <option value="">Automatic</option>
              {[1, 2, 3, 4, 5].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" className={btnPrimary}>
          Save changes
        </button>
      </ActionForm>

      <section className="space-y-3" aria-labelledby="status-heading">
        <h2 id="status-heading" className={h2}>
          {sentence.is_active ? "Active" : "Inactive"}
        </h2>
        <p className={muted}>
          {sentence.is_active
            ? "Deactivating stops this sentence from being offered to contributors. Existing contributions are kept."
            : "This sentence is not offered to contributors."}
        </p>
        <ActionForm action={setSentenceActive} className="flex flex-wrap gap-2">
          <input type="hidden" name="id" value={sentence.id} />
          <input type="hidden" name="active" value={sentence.is_active ? "false" : "true"} />
          <button type="submit" className={btnSecondary}>
            {sentence.is_active ? "Deactivate" : "Activate"}
          </button>
        </ActionForm>
      </section>

      {!used && (
        <section className="space-y-3" aria-labelledby="delete-heading">
          <h2 id="delete-heading" className={h2}>
            Delete
          </h2>
          <p className={muted}>Nobody has contributed to this sentence yet, so it can be deleted permanently.</p>
          <ActionForm action={deleteSentence} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={sentence.id} />
            <button type="submit" className={btnDanger}>
              Delete sentence
            </button>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
