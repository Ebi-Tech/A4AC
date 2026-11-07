import Link from "next/link";
import { addFrenchVersion, setFrenchStatus } from "@/app/admin/actions";
import { ActionForm } from "@/components/action-form";
import { btnPrimary, btnSecondary, card, h1, input, muted } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";

const PAGE_SIZE = 20;
const FILTERS = [
  { value: "all", text: "All" },
  { value: "missing", text: "No French yet" },
  { value: "unverified", text: "Waiting for verification" },
  { value: "verified", text: "Verified" },
] as const;

const BADGE: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  unverified: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  missing: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200",
};

const BADGE_TEXT: Record<string, string> = {
  verified: "French verified",
  unverified: "French waiting",
  missing: "No French",
};

/**
 * French anchors: each English sentence with the state of its French
 * version. Admins can add a French version (stored as verified) or verify or
 * reject one written by a contributor. A French version only counts as an
 * anchor once verified.
 *
 * @param props.searchParams "q", "filter", "page".
 * @returns The anchors page.
 */
export default async function AdminAnchorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const filter = FILTERS.some((f) => f.value === params.filter) ? params.filter! : "all";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const { data: rows, error } = await supabase.rpc("admin_anchor_list", {
    p_search: q,
    p_filter: filter,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const total = rows?.[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /**
   * Builds a link to this page with a different page number.
   *
   * @param target Page number.
   * @returns The URL.
   */
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (filter !== "all") query.set("filter", filter);
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `/admin/anchors?${qs}` : "/admin/anchors";
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={h1}>French anchors</h1>
        <p className={muted}>
          French readers only get sentences that have a verified French version. {total} sentence
          {total === 1 ? "" : "s"} shown.
        </p>
      </div>

      <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto]" role="search">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Search English text" className={input} />
        <label htmlFor="filter" className="sr-only">
          French status
        </label>
        <select id="filter" name="filter" defaultValue={filter} className={input}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.text}
            </option>
          ))}
        </select>
        <button type="submit" className={btnSecondary}>
          Filter
        </button>
      </form>

      {error && <p role="alert">Could not load sentences: {error.message}</p>}

      <ul className="space-y-3">
        {rows?.map((row) => (
          <li key={row.sentence_id} className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium">{row.text}</p>
              <span className={`rounded-full px-3 py-1 text-sm font-medium ${BADGE[row.french_status]}`}>
                {BADGE_TEXT[row.french_status]}
              </span>
            </div>

            {row.french_text && (
              <p lang="fr" className="rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-800">
                {row.french_text}
              </p>
            )}

            {row.french_status === "unverified" && row.french_translation_id && (
              <div className="flex flex-wrap gap-2">
                <ActionForm action={setFrenchStatus} className="flex flex-wrap gap-2">
                  <input type="hidden" name="translation_id" value={row.french_translation_id} />
                  <input type="hidden" name="status" value="verified" />
                  <button type="submit" className={btnPrimary}>
                    Verify
                  </button>
                </ActionForm>
                <ActionForm action={setFrenchStatus} className="flex flex-wrap gap-2">
                  <input type="hidden" name="translation_id" value={row.french_translation_id} />
                  <input type="hidden" name="status" value="rejected" />
                  <button type="submit" className={btnSecondary}>
                    Reject
                  </button>
                </ActionForm>
              </div>
            )}

            {row.french_status !== "verified" && (
              <ActionForm action={addFrenchVersion} className="flex flex-col gap-2 sm:flex-row">
                <input type="hidden" name="sentence_id" value={row.sentence_id} />
                <label htmlFor={`fr-${row.sentence_id}`} className="sr-only">
                  French version
                </label>
                <input
                  id={`fr-${row.sentence_id}`}
                  name="text"
                  lang="fr"
                  required
                  placeholder="Write the French version"
                  className={input}
                />
                <button type="submit" className={btnSecondary}>
                  Add French
                </button>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={btnSecondary}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className={muted}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className={btnSecondary}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
