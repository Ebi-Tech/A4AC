"use client";

import { useActionState } from "react";
import { acceptConsent } from "@/app/actions/profile";
import { FormMessage } from "@/components/form-message";
import { btnPrimary } from "@/components/ui";
import { initialFormState } from "@/lib/form-state";

const checkRow =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-stone-200 px-4 py-3 text-base font-medium has-checked:border-emerald-700 dark:border-stone-800";

/**
 * The two consent checkboxes ("I am 18 or older", "I agree") and the
 * continue button.
 *
 * @param props.version Version of the consent text shown on the page.
 * @returns The consent form.
 */
export function ConsentForm({ version }: { version: string }) {
  const [state, action, pending] = useActionState(acceptConsent, initialFormState);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <label className={checkRow}>
        <input type="checkbox" name="adult" required className="size-6 accent-emerald-700" />I am 18 or older
      </label>
      <label className={checkRow}>
        <input type="checkbox" name="agree" required className="size-6 accent-emerald-700" />I agree
      </label>
      <FormMessage state={state} />
      <div className="pt-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          {pending ? "Saving…" : "Continue"}
        </button>
      </div>
    </form>
  );
}
