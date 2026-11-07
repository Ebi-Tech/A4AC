"use client";

import { useActionState } from "react";
import { saveDisplayName } from "@/app/actions/profile";
import { FormMessage } from "@/components/form-message";
import { btnPrimary, input, label, muted } from "@/components/ui";
import { initialFormState } from "@/lib/form-state";

/**
 * Form to set the public display name. Leaving it blank keeps the current
 * (anonymous) name.
 *
 * @param props.currentName The name shown today, e.g. "Contributor 4821".
 * @param props.context     "onboarding" (moves to the next step) or "profile".
 * @returns The form.
 */
export function DisplayNameForm({ currentName, context }: { currentName: string; context: "onboarding" | "profile" }) {
  const [state, action, pending] = useActionState(saveDisplayName, initialFormState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="context" value={context} />
      <div>
        <label htmlFor="display_name" className={label}>
          Display name <span className={`font-normal ${muted}`}>(optional)</span>
        </label>
        <input
          id="display_name"
          name="display_name"
          maxLength={80}
          autoComplete="nickname"
          className={input}
          placeholder={currentName}
          defaultValue={context === "profile" ? currentName : ""}
        />
        <p className={`mt-2 text-sm ${muted}`}>
          This is shown next to your contributions. Leave it empty to stay “{currentName}”. Don’t use your email.
        </p>
      </div>
      <FormMessage state={state} />
      <button type="submit" className={btnPrimary} disabled={pending}>
        {pending ? "Saving…" : context === "onboarding" ? "Continue" : "Save name"}
      </button>
    </form>
  );
}
