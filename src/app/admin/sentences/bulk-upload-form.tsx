"use client";

import { useActionState } from "react";
import { bulkUpload, type BulkUploadState } from "@/app/admin/actions";
import { FormMessage } from "@/components/form-message";
import { btnPrimary, input, label, muted } from "@/components/ui";
import { SKIP_REASON_TEXT, type SkipReason } from "@/lib/sentence-import";

const initial: BulkUploadState = {};

/**
 * Bulk upload of a sentence file (.txt, .csv or .tsv) with source and licence,
 * showing the import summary afterwards.
 *
 * @returns The upload form and, after submitting, the summary.
 */
export function BulkUploadForm() {
  const [state, action, pending] = useActionState(bulkUpload, initial);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="bulk-file" className={label}>
          File
        </label>
        <input id="bulk-file" name="file" type="file" accept=".txt,.csv,.tsv" required className={`${input} py-3`} />
        <p className={`mt-1 text-sm ${muted}`}>
          .txt: one sentence per line. .csv / .tsv: columns text, topic, difficulty (header optional). Max 4 MB.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="bulk-source" className={label}>
            Source
          </label>
          <input id="bulk-source" name="source" required className={input} placeholder="e.g. Volunteer list, Nov 2026" />
        </div>
        <div>
          <label htmlFor="bulk-license" className={label}>
            Licence
          </label>
          <input id="bulk-license" name="license" required className={input} placeholder="e.g. CC0-1.0" />
        </div>
      </div>
      <FormMessage state={state} />
      {state.summary && Object.keys(state.summary.skipped).length > 0 && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">Skipped</p>
          <ul className="space-y-1">
            {(Object.entries(state.summary.skipped) as [SkipReason, number][]).map(([reason, count]) => (
              <li key={reason}>
                {count} × {SKIP_REASON_TEXT[reason]}
              </li>
            ))}
          </ul>
          <p className="font-medium">First skipped lines</p>
          <ul className={`space-y-1 ${muted}`}>
            {state.summary.examples.map((row) => (
              <li key={`${row.line}-${row.reason}`}>
                Line {row.line}: “{row.text}” ({SKIP_REASON_TEXT[row.reason]})
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="submit" className={btnPrimary} disabled={pending}>
        {pending ? "Uploading…" : "Upload and import"}
      </button>
    </form>
  );
}
