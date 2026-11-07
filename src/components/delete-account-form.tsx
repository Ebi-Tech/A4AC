"use client";

import { useActionState } from "react";
import { deleteAccount } from "@/app/actions/profile";
import { FormMessage } from "@/components/form-message";
import { btnDanger, input, label, muted } from "@/components/ui";
import { initialFormState } from "@/lib/form-state";

/**
 * "Delete my account" section. The confirmation form is hidden until opened,
 * and the user must type DELETE before the button does anything.
 *
 * @returns The delete-account disclosure.
 */
export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteAccount, initialFormState);

  return (
    <details className="rounded-2xl border border-red-300 dark:border-red-900">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-red-800 dark:text-red-300">
        Delete my account
      </summary>
      <form action={action} className="space-y-4 px-4 pb-4">
        <p>This permanently deletes:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>your account and profile</li>
          <li>all your translations, transcripts, reviews and flags</li>
          <li>all your voice recordings, including the audio files</li>
        </ul>
        <p className={muted}>
          This cannot be undone. Contributions already included in a published dataset release cannot be recalled
          from copies other people have downloaded.
        </p>
        <div>
          <label htmlFor="confirm-delete" className={label}>
            Type DELETE to confirm
          </label>
          <input
            id="confirm-delete"
            name="confirm"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            className={input}
          />
        </div>
        <FormMessage state={state} />
        <button type="submit" className={btnDanger} disabled={pending}>
          {pending ? "Deleting…" : "Delete everything"}
        </button>
      </form>
    </details>
  );
}
