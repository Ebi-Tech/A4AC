"use client";

import { useActionState } from "react";
import { requestLanguage } from "@/app/actions/profile";
import { FormMessage } from "@/components/form-message";
import { btnSecondary, input, label, muted } from "@/components/ui";
import { initialFormState } from "@/lib/form-state";

/**
 * Collapsible form to ask for a language that is not in the list yet.
 *
 * @returns The request form inside a disclosure.
 */
export function LanguageRequestForm() {
  const [state, action, pending] = useActionState(requestLanguage, initialFormState);

  return (
    <details className="rounded-2xl border border-stone-200 dark:border-stone-800">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 font-medium">My language is not listed</summary>
      <form action={action} className="space-y-4 px-4 pb-4">
        <p className={muted}>Tell us which language you speak and we will look into adding it.</p>
        <div>
          <label htmlFor="request-name" className={label}>
            Language name
          </label>
          <input id="request-name" name="name" required maxLength={100} className={input} />
        </div>
        <div>
          <label htmlFor="request-iso" className={label}>
            3-letter code <span className={`font-normal ${muted}`}>(optional)</span>
          </label>
          <input
            id="request-iso"
            name="iso_code"
            maxLength={3}
            autoCapitalize="none"
            autoCorrect="off"
            className={input}
            placeholder="e.g. lug"
          />
        </div>
        <div>
          <label htmlFor="request-note" className={label}>
            Anything else? <span className={`font-normal ${muted}`}>(optional)</span>
          </label>
          <textarea
            id="request-note"
            name="note"
            rows={3}
            maxLength={1000}
            className={`${input} py-3`}
            placeholder="Where it is spoken, other names for it…"
          />
        </div>
        <FormMessage state={state} />
        <button type="submit" className={btnSecondary} disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </button>
      </form>
    </details>
  );
}
