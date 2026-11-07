import type { FormState } from "@/lib/form-state";

/**
 * Shows the error or success message returned by a server action, announced
 * to screen readers.
 *
 * @param props.state The action's latest result.
 * @returns A message paragraph, or nothing when there is no message.
 */
export function FormMessage({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
        {state.success}
      </p>
    );
  }
  return null;
}
