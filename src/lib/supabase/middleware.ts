import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminPath, isOnboardingExempt, isPublicPath, safeNextPath } from "@/lib/routes";
import type { Database } from "@/types/database";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * Builds a redirect that keeps any auth cookies refreshed during this request.
 *
 * @param request  The incoming request (for the base URL).
 * @param response The response holding refreshed cookies.
 * @param target   Internal path (may include a query string) to send the user to.
 * @returns A redirect response.
 */
function redirectTo(request: NextRequest, response: NextResponse, target: string) {
  const redirect = NextResponse.redirect(new URL(target, request.url));
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

/**
 * Answers with the normal "page not found" screen, so the admin area looks
 * exactly like a missing page to anyone who is not an admin.
 *
 * @param request  The incoming request.
 * @param response The response holding refreshed cookies.
 * @returns A 404 rewrite.
 */
function notFound(request: NextRequest, response: NextResponse) {
  const rewrite = NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  response.cookies.getAll().forEach((cookie) => rewrite.cookies.set(cookie));
  return rewrite;
}

/**
 * Refreshes the Supabase session on every request and applies access rules:
 * the admin area returns 404 to everyone except admins; signed-out visitors
 * may only open public pages (otherwise they go to /login with a "next"
 * path); signed-in users visiting /login go to "next"; and signed-in users
 * who have not finished onboarding (or must re-accept changed consent) are
 * sent to /onboarding.
 *
 * @param request The incoming Next.js request.
 * @returns The response to continue with, a redirect, or a 404.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  if (isAdminPath(path)) {
    if (!user) return notFound(request, response);
    const { data: admin } = await supabase.rpc("is_admin");
    if (!admin) return notFound(request, response);
  }

  if (!user) {
    if (isPublicPath(path)) return response;
    const next = encodeURIComponent(path + request.nextUrl.search);
    return redirectTo(request, response, `/login?next=${next}`);
  }

  if (path === "/login") {
    return redirectTo(request, response, safeNextPath(request.nextUrl.searchParams.get("next")));
  }
  if (isOnboardingExempt(path)) return response;

  const { data: status } = await supabase.rpc("onboarding_status");
  if (status === "consent" || status === "profile") {
    return redirectTo(request, response, "/onboarding");
  }

  return response;
}
