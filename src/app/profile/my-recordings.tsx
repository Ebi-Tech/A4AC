import Link from "next/link";
import { deleteMyRecording } from "@/app/actions/speak";
import { ActionForm } from "@/components/action-form";
import { btnDanger, btnSecondary, card, h2, muted } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { PlayButton } from "./play-button";

const PAGE_SIZE = 10;

const STATUS_TEXT: Record<string, string> = {
  pending: "Waiting for review",
  unverified: "Reviewed, not settled yet",
  verified: "Verified",
  rejected: "Rejected",
};

/**
 * "My recordings" section of the profile: the user's own recordings, newest
 * first, ten per page, with a play button and delete for pending ones.
 *
 * @param props.userId The signed-in user's id.
 * @param props.page   Page number (1-based).
 * @returns The section.
 */
export async function MyRecordings({ userId, page }: { userId: string; page: number }) {
  const supabase = await createClient();
  const { data: rows, count } = await supabase
    .from("recordings")
    .select(
      "id, mode, status, duration_ms, created_at, sentence:sentences(text), language:languages!recordings_language_id_fkey(name), translation:translations(text)",
      { count: "exact" },
    )
    .eq("contributor_id", userId)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <section aria-labelledby="my-recordings-heading" className="space-y-3" id="my-recordings">
      <h2 id="my-recordings-heading" className={h2}>
        My recordings
      </h2>
      {!rows?.length && <p className={muted}>You have not made any recordings yet.</p>}
      <ul className="space-y-3">
        {rows?.map((row) => (
          <li key={row.id} className={`${card} space-y-2`}>
            <p className={`text-sm ${muted}`}>
              {row.language?.name} · {row.mode === "read_aloud" ? "Read aloud" : "Translate and speak"} ·{" "}
              {((row.duration_ms ?? 0) / 1000).toFixed(1)} s · {STATUS_TEXT[row.status]}
            </p>
            <p>{row.mode === "read_aloud" && row.translation ? row.translation.text : row.sentence?.text}</p>
            <div className="flex flex-wrap items-center gap-2">
              <PlayButton recordingId={row.id} />
              {row.status === "pending" && (
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium underline">Delete</summary>
                  <ActionForm action={deleteMyRecording} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={row.id} />
                    <span className="text-sm">Delete this recording?</span>
                    <button type="submit" className={btnDanger}>
                      Yes, delete recording
                    </button>
                  </ActionForm>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <nav aria-label="My recordings pages" className="flex items-center justify-between gap-2">
          {page > 1 ? (
            <Link href={`/profile?rpage=${page - 1}#my-recordings`} className={btnSecondary}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className={muted}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/profile?rpage=${page + 1}#my-recordings`} className={btnSecondary}>
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
