import type { Metadata } from "next";
import { signInWithGoogle } from "@/app/actions/auth";
import { btnSecondary, h1, muted } from "@/components/ui";
import { safeNextPath } from "@/lib/routes";
import { googleSignInEnabled } from "@/lib/supabase/env";
import { EmailSignInForm } from "./email-sign-in-form";

export const metadata: Metadata = { title: "Sign in · A4AC" };

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Please ask for a new one.",
  google: "Google sign-in did not work. Please try again or use your email.",
};

/**
 * Sign-in page: email magic link, plus Google when it is configured.
 *
 * @param props.searchParams May contain "next" (where to go after sign-in) and "error".
 * @returns The sign-in page.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next);
  const showGoogle = googleSignInEnabled();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className={h1}>Sign in</h1>
        <p className={muted}>No password needed. We will email you a link that signs you in.</p>
      </div>

      {error && ERRORS[error] && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
          {ERRORS[error]}
        </p>
      )}

      <EmailSignInForm next={nextPath} />

      {showGoogle && (
        <>
          <div className={`flex items-center gap-3 text-sm ${muted}`}>
            <span className="h-px flex-1 bg-stone-300 dark:bg-stone-700" />
            or
            <span className="h-px flex-1 bg-stone-300 dark:bg-stone-700" />
          </div>
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={nextPath} />
            <button type="submit" className={`${btnSecondary} sm:w-full`}>
              Continue with Google
            </button>
          </form>
        </>
      )}

      <p className={`text-sm ${muted}`}>
        By signing in you can read the consent terms before contributing anything. Your email is never shown to
        anyone.
      </p>
    </div>
  );
}
