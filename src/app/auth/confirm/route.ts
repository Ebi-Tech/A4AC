import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { decodeNextParam, safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Works out where to send the user after the email link. Accepts, in order:
 * a plain "next" path, an encoded "to" value, or the "to" value inside the
 * "redirect_to" URL that Supabase passes through from the sign-in request.
 * Every option is reduced to a safe internal path.
 *
 * @param params The request's query parameters.
 * @returns A safe internal path ("/" by default).
 */
function nextFromParams(params: URLSearchParams): string {
  const next = params.get("next");
  if (next) return safeNextPath(next);

  const to = params.get("to");
  if (to) return decodeNextParam(to);

  const redirectTo = params.get("redirect_to");
  if (redirectTo) {
    try {
      return decodeNextParam(new URL(redirectTo).searchParams.get("to"));
    } catch {
      return "/";
    }
  }
  return "/";
}

/**
 * Handles the link in the magic-link email. Verifies the one-time token hash,
 * starts a session and returns the user to the page they wanted. Works in any
 * browser, so it is safe for links opened inside a phone's mail app.
 *
 * @param request GET request with "token_hash", "type" and a destination (see nextFromParams).
 * @returns A redirect to the destination or to /login with an error.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "email") as EmailOtpType;

  if (tokenHash) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(nextFromParams(searchParams), request.url));
  }

  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
