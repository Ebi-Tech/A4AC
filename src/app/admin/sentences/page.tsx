import Link from "next/link";
import { addSentence, setSentenceActive } from "@/app/admin/actions";
import { ActionForm } from "@/components/action-form";
import { btnPrimary, btnSecondary, card, h1, h2, input, label, muted } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { BulkUploadForm } from "./bulk-upload-form";

const PAGE_SIZE = 25;
type StatusFilter = "active" | "inactive" | "all";

/**
 * Escapes the wildcard characters of an ILIKE pattern so a search is literal.
 *
 * @param value The search text.
 * @returns The escaped text.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Builds a link to this page with the given filters.
 *
 * @param params Current filters merged with the changes.
 * @returns The URL path with query string.
 */
function listHref(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && !(key === "page" && value === 1)) query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `/admin/sentences?${qs}` : "/admin/sentences";
}

/**
 * Admin sentence bank: search, filter by topic and active state, paginate,
 * activate/deactivate, add a single sentence and bulk upload a file.
 *
 * @param props.searchParams "q", "topic", "status", "page".
 * @returns The sentences page.
 */
export default async function AdminSentencesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; topic?: string; status?: string; page?: string; deleted?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const topic = (params.topic ?? "").trim();
  const status: StatusFilter = params.status === "inactive" || params.status === "all" ? params.status : "active";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let query = supabase
    .from("sentences")
    .select("id, text, topic, difficulty, is_active, source", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.ilike("text", `%${escapeLike(q)}%`);
  if (topic) query = query.eq("topic", topic);
  if (status !== "all") query = query.eq("is_active", status === "active");

  const [{ data: sentences, count, error }, { data: topics }] = await Promise.all([query, supabase.rpc("sentence_topics")]);
  const ids = sentences?.map((s) => s.id) ?? [];
  const { data: usage } = ids.length ? await supabase.rpc("admin_sentence_usage", { p_ids: ids }) : { data: [] };
  const usageById = new Map((usage ?? []).map((u) => [u.sentence_id, u]));
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const current = { q, topic, status, page };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className={h1}>Sentences</h1>
        <p className={muted}>{count ?? 0} found</p>
      </div>

      {params.deleted && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Sentence deleted.
        </p>
      )}

      <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]" role="search">
        <label className="sr-only" htmlFor="q">
          Search
        </label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Search text" className={input} />
        <label className="sr-only" htmlFor="topic">
          Topic
        </label>
        <select id="topic" name="topic" defaultValue={topic} className={input}>
          <option value="">All topics</option>
          {(topics ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={status} className={input}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <button type="submit" className={btnSecondary}>
          Filter
        </button>
      </form>

      {error && <p role="alert">Could not load sentences: {error.message}</p>}

      <ul className="space-y-3">
        {sentences?.map((sentence) => {
          const used = usageById.get(sentence.id);
          return (
            <li key={sentence.id} className={card}>
              <p className="text-base">{sentence.text}</p>
              <p className={`mt-1 text-sm ${muted}`}>
                {sentence.topic ?? "no topic"} · difficulty {sentence.difficulty ?? "–"} ·{" "}
                {used ? `${used.translations} translations, ${used.recordings} recordings` : "no contributions"}
                {!sentence.is_active && " · inactive"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/admin/sentences/${sentence.id}`} className={`${btnSecondary} sm:w-auto`}>
                  Edit
                </Link>
                <ActionForm action={setSentenceActive} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={sentence.id} />
                  <input type="hidden" name="active" value={sentence.is_active ? "false" : "true"} />
                  <button type="submit" className={btnSecondary}>
                    {sentence.is_active ? "Deactivate" : "Activate"}
                  </button>
                </ActionForm>
              </div>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2">
          {page > 1 ? (
            <Link href={listHref({ ...current, page: page - 1 })} className={btnSecondary}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className={muted}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={listHref({ ...current, page: page + 1 })} className={btnSecondary}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <section className="space-y-4" aria-labelledby="add-heading">
        <h2 id="add-heading" className={h2}>
          Add a sentence
        </h2>
        <ActionForm action={addSentence} className="space-y-4">
          <div>
            <label htmlFor="new-text" className={label}>
              English sentence
            </label>
            <input id="new-text" name="text" required className={input} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="new-topic" className={label}>
                Topic <span className={`font-normal ${muted}`}>(optional)</span>
              </label>
              <input id="new-topic" name="topic" className={input} placeholder="e.g. market" />
            </div>
            <div>
              <label htmlFor="new-difficulty" className={label}>
                Difficulty
              </label>
              <select id="new-difficulty" name="difficulty" className={input} defaultValue="">
                <option value="">Automatic</option>
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="new-source" className={label}>
                Source
              </label>
              <input id="new-source" name="source" className={input} defaultValue="admin" />
            </div>
            <div>
              <label htmlFor="new-license" className={label}>
                Licence
              </label>
              <input id="new-license" name="license" required className={input} defaultValue="CC0-1.0" />
            </div>
          </div>
          <button type="submit" className={btnPrimary}>
            Add sentence
          </button>
        </ActionForm>
      </section>

      <section className="space-y-4" aria-labelledby="bulk-heading">
        <h2 id="bulk-heading" className={h2}>
          Bulk upload
        </h2>
        <BulkUploadForm />
      </section>
    </div>
  );
}
