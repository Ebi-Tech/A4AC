"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form-message";
import { initialFormState, type FormState } from "@/lib/form-state";

/**
 * A form that runs a server action and shows its error or success message
 * underneath. Fields and buttons are passed in as children, so server
 * components can render them.
 *
 * @param props.action    Server action taking (previous state, form data).
 * @param props.children  Fields and submit button(s).
 * @param props.className Classes for the form element.
 * @returns The form.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);

  return (
    <form action={formAction} className={className} aria-busy={pending}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      <div className="basis-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
