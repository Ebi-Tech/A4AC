import Link from "next/link";
import { deleteMyTranslation, updateMyTranslation } from "@/app/actions/write";
import { ActionForm } from "@/components/action-form";
import { btnDanger, btnPrimary, btnSecondary, card, h2, input, muted } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 10;

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200",
  unverified: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  verified: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

const STATUS_TEXT: Record<string, string> = {
  pending: "Waiting for review",
  unverified: "Reviewed, not settled yet",
  verified: "Verified",
  rejected: "Rejected",
};

/**
 * "My translations" section of the profile: the user's own translations,
 * newest first, ten per page. Pending, unverified and verified ones can be
 * edited (editing sends them back for review); pending ones can be deleted.
 *
 * @param props.userId The signed-in user's id.
 * @param props.page   Page number (1-based).
 * @returns The section.
 */
export async function MyTranslations({ userId, page }: { userId: string; page: number }) {
  const supabase = await createClient();
  const { data: rows, count } = await supabase
    .from("translations")
    .select("id, text, status, created_at, sentence:sentences(text), language:languages!translations_language_id_fkey(name)", {
      count: "exact",
    })
    .eq("contributor_id", userId)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <section aria-labelledby="my-translations-heading" className="space-y-3" id="my-translations">
      <h2 id="my-translations-heading" className={h2}>
        My translations
      </h2>
      {!rows?.length && <p className={muted}>You have not written any translations yet.</p>}
      <ul className="space-y-3">
        {rows?.map((row) => (
          <li key={row.id} className={`${card} space-y-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`text-sm ${muted}`}>{row.language?.name}</span>
              <span className={`rounded-full px-3 py-0.5 text-sm font-medium ${STATUS_STYLE[row.status]}`}>
                {STATUS_TEXT[row.status]}
              </span>
            </div>
            <p className={`text-sm ${muted}`}>{row.sentence?.text}</p>
            <p className="text-lg">{row.text}</p>

            {row.status !== "rejected" && (
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium underline">Edit</summary>
                <ActionForm action={updateMyTranslation} className="mt-2 space-y-2">
                  <input type="hidden" name="id" value={row.id} />
                  <label htmlFor={`edit-${row.id}`} className="sr-only">
                    Translation
                  </label>
                  <textarea
                    id={`edit-${row.id}`}
                    name="text"
                    defaultValue={row.text}
                    rows={2}
                    maxLength={1000}
                    autoCorrect="off"
                    spellCheck={false}
                    className={`${input} py-2`}
                  />
                  {row.status === "verified" && (
                    <p className={`text-sm ${muted}`}>This one is verified. Changing it sends it back for review.</p>
                  )}
                  <button type="submit" className={btnPrimary}>
                    Save
                  </button>
                </ActionForm>
              </details>
            )}

            {row.status === "pending" && (
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium underline">Delete</summary>
                <ActionForm action={deleteMyTranslation} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={row.id} />
                  <span className="text-sm">Delete this translation?</span>
                  <button type="submit" className={btnDanger}>
                    Yes, delete
                  </button>
                </ActionForm>
              </details>
            )}
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <nav aria-label="My translations pages" className="flex items-center justify-between gap-2">
          {page > 1 ? (
            <Link href={`/profile?tpage=${page - 1}#my-translations`} className={btnSecondary}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className={muted}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/profile?tpage=${page + 1}#my-translations`} className={btnSecondary}>
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}
