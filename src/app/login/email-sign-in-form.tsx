"use client";

import { useActionState } from "react";
import { signInWithEmail } from "@/app/actions/auth";
import { FormMessage } from "@/components/form-message";
import { btnPrimary, input, label } from "@/components/ui";
import { initialFormState } from "@/lib/form-state";

/**
 * Email field and button that request a magic sign-in link. Shows a
 * confirmation in place once the email has been sent.
 *
 * @returns The sign-in form.
 */
export function EmailSignInForm() {
  const [state, action, pending] = useActionState(signInWithEmail, initialFormState);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className={label}>
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className={input}
          placeholder="you@example.com"
        />
      </div>
      <FormMessage state={state} />
      <button type="submit" className={`${btnPrimary} sm:w-full`} disabled={pending}>
        {pending ? "Sending…" : state.success ? "Send another link" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
