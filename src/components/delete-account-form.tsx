"use client";

import { useActionState } from "react";
import { deleteAccount } from "@/app/actions/profile";
import { FormMessage } from "@/components/form-message";
import { btnDanger, input, label, muted } from "@/components/ui";
import { initialFormState } from "@/lib/form-state";

/**
 * "Delete my account" disclosure used on the profile page and, in a compact
 * form, on the onboarding screen. The confirmation form stays hidden until
 * opened, and the user must type DELETE before anything is deleted.
 *
 * @param props.compact Show a small text link instead of a bordered panel (onboarding).
 * @returns The delete-account disclosure.
 */
export function DeleteAccountForm({ compact = false }: { compact?: boolean }) {
  const [state, action, pending] = useActionState(deleteAccount, initialFormState);

  return (
    <details className={compact ? "" : "rounded-2xl border border-red-300 dark:border-red-900"}>
      <summary
        className={
          compact
            ? `inline-flex min-h-11 cursor-pointer items-center text-sm underline ${muted}`
            : "flex min-h-12 cursor-pointer items-center px-4 font-semibold text-red-800 dark:text-red-300"
        }
      >
        Delete my account
      </summary>
      <form
        action={action}
        className={
          compact
            ? "mt-2 space-y-4 rounded-2xl border border-red-300 p-4 dark:border-red-900"
            : "space-y-4 px-4 pb-4"
        }
      >
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
