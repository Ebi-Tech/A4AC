import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles the link in the magic-link email. Verifies the one-time token hash
 * and starts a session. Works in any browser, so it is safe for links opened
 * inside a phone's mail app.
 *
 * @param request GET request with "token_hash", "type" and optional "next".
 * @returns A redirect to "next" (default "/") or to /login with an error.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "email") as EmailOtpType;
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
