"use client";

import { useState } from "react";
import { btnPrimary, btnSecondary, input, muted } from "@/components/ui";

export type SkipChoice = "not_sure" | "unclear" | "report";

/**
 * The shared Skip menu for the write and speak tasks: "I'm not sure how to
 * say this", "The sentence is unclear", or "Report this sentence" with an
 * optional reason.
 *
 * @param props.busy   Disables the buttons while a request is running.
 * @param props.onSkip Called with the chosen reason and, for reports, the note.
 * @returns The skip panel.
 */
export function SkipPanel({ busy, onSkip }: { busy: boolean; onSkip: (reason: SkipChoice, note?: string) => void }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [note, setNote] = useState("");

  return (
    <div className="space-y-2 rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
      <p className="font-medium">Why are you skipping?</p>
      <button type="button" className={`${btnSecondary} sm:w-full`} onClick={() => onSkip("not_sure")} disabled={busy}>
        I&apos;m not sure how to say this
      </button>
      <button type="button" className={`${btnSecondary} sm:w-full`} onClick={() => onSkip("unclear")} disabled={busy}>
        The sentence is unclear
      </button>
      {reportOpen ? (
        <div className="space-y-2">
          <label htmlFor="report-note" className="block text-sm font-medium">
            What is wrong with it? <span className={`font-normal ${muted}`}>(optional)</span>
          </label>
          <textarea
            id="report-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            className={`${input} py-2`}
          />
          <button type="button" className={`${btnPrimary} sm:w-full`} onClick={() => onSkip("report", note)} disabled={busy}>
            Send report and skip
          </button>
        </div>
      ) : (
        <button type="button" className={`${btnSecondary} sm:w-full`} onClick={() => setReportOpen(true)} disabled={busy}>
          Report this sentence
        </button>
      )}
    </div>
  );
}
