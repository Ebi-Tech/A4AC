import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles the return from Google (OAuth, PKCE). Exchanges the code for a
 * session and sends the user on.
 *
 * @param request GET request with "code" and optional "next".
 * @returns A redirect to "next" (default "/") or to /login with an error.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  return NextResponse.redirect(new URL("/login?error=google", request.url));
}
