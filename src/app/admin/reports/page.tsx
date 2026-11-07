import { resolveReport } from "@/app/admin/actions";
import { ActionForm } from "@/components/action-form";
import { btnDanger, btnSecondary, card, h1, muted } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Sentence reports sent by contributors from the Skip menu. Admins can
 * dismiss a report or deactivate the sentence.
 *
 * @returns The reports page.
 */
export default async function AdminReportsPage() {
  const { supabase } = await requireAdmin();
  const { data: reports, error } = await supabase
    .from("sentence_reports")
    .select(
      "id, reason, created_at, sentence:sentences(id, text, is_active), language:languages(name), reporter:profiles!sentence_reports_reporter_id_fkey(display_name)",
    )
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);

  const perSentence = new Map<string, number>();
  for (const r of reports ?? []) if (r.sentence) perSentence.set(r.sentence.id, (perSentence.get(r.sentence.id) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={h1}>Reports</h1>
        <p className={muted}>{reports?.length ?? 0} open report{reports?.length === 1 ? "" : "s"}, oldest first.</p>
      </div>
      {error && <p role="alert">Could not load reports: {error.message}</p>}

      <ul className="space-y-3">
        {reports?.map((report) => (
          <li key={report.id} className={`${card} space-y-3`} data-report-sentence={report.sentence?.id}>
            <p className="text-lg font-medium">{report.sentence?.text}</p>
            <p className={`text-sm ${muted}`}>
              {report.language?.name ?? "Unknown language"} · by {report.reporter?.display_name ?? "a former user"} ·{" "}
              {dateFormat.format(new Date(report.created_at))}
              {report.sentence && (perSentence.get(report.sentence.id) ?? 0) > 1
                ? ` · ${perSentence.get(report.sentence.id)} open reports on this sentence`
                : ""}
              {report.sentence && !report.sentence.is_active ? " · already inactive" : ""}
            </p>
            {report.reason ? <p>“{report.reason}”</p> : <p className={muted}>No reason given.</p>}
            <div className="flex flex-wrap gap-2">
              <ActionForm action={resolveReport} className="flex flex-wrap gap-2">
                <input type="hidden" name="report_id" value={report.id} />
                <input type="hidden" name="action" value="dismiss" />
                <button type="submit" className={btnSecondary}>
                  Dismiss
                </button>
              </ActionForm>
              <ActionForm action={resolveReport} className="flex flex-wrap gap-2">
                <input type="hidden" name="report_id" value={report.id} />
                <input type="hidden" name="action" value="deactivate" />
                <button type="submit" className={btnDanger}>
                  Deactivate sentence
                </button>
              </ActionForm>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
