"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { encodeNextParam, safeNextPath } from "@/lib/routes";
import { googleSignInEnabled, siteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Works out the site URL for auth redirects from env or the request headers.
 *
 * @returns The site origin, e.g. "https://example.org".
 */
async function requestSiteUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return siteUrl(h.get("origin") ?? (host ? `${proto}://${host}` : null));
}

/**
 * Sends a passwordless sign-in link to the given email address. New emails
 * get an account automatically. The page the user wanted ("next") is
 * encoded into the link so they return to it after signing in.
 *
 * @param _prev    Previous form state (unused).
 * @param formData Form fields: "email", "next" (optional internal path).
 * @returns A success message naming the address, or an error.
 */
export async function signInWithEmail(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Please enter a valid email address." };
  }
  const next = safeNextPath(String(formData.get("next") ?? "/"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${await requestSiteUrl()}/auth/confirm?to=${encodeNextParam(next)}`,
    },
  });

  if (error) {
    return {
      error:
        error.status === 429
          ? "Too many sign-in emails. Please wait a few minutes and try again."
          : "We could not send the email. Please try again.",
    };
  }
  return { success: `We sent a sign-in link to ${email}. Open it on this phone or computer to continue.` };
}

/**
 * Starts Google sign-in and sends the browser to Google. Does nothing useful
 * if Google keys are not configured, so the button is hidden in that case.
 *
 * @param formData Form fields: "next" (path to return to afterwards).
 * @returns Never returns normally; redirects to Google or back to /login.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  if (!googleSignInEnabled()) redirect("/login");

  const next = safeNextPath(String(formData.get("next") ?? "/"));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await requestSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

/**
 * Signs the current user out and returns to the home page.
 *
 * @returns Never returns normally; redirects to "/".
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
