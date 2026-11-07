import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isOnboardingExempt, isPublicPath } from "@/lib/routes";
import type { Database } from "@/types/database";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * Builds a redirect that keeps any auth cookies refreshed during this request.
 *
 * @param request  The incoming request (for the base URL).
 * @param response The response holding refreshed cookies.
 * @param path     Where to send the user.
 * @param params   Optional query parameters to add.
 * @returns A redirect response.
 */
function redirectTo(request: NextRequest, response: NextResponse, path: string, params: Record<string, string> = {}) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = new URLSearchParams(params).toString();
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

/**
 * Refreshes the Supabase session on every request and applies access rules:
 * signed-out visitors may only open public pages (otherwise they go to /login),
 * signed-in users skip /login, and signed-in users who have not finished
 * onboarding (or must re-accept changed consent) are sent to /onboarding.
 *
 * @param request The incoming Next.js request.
 * @returns The response to continue with, or a redirect.
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

  if (!user) {
    if (isPublicPath(path)) return response;
    return redirectTo(request, response, "/login", { next: path + request.nextUrl.search });
  }

  if (path === "/login") return redirectTo(request, response, "/");
  if (isOnboardingExempt(path)) return response;

  const { data: status } = await supabase.rpc("onboarding_status");
  if (status === "consent" || status === "profile") {
    return redirectTo(request, response, "/onboarding");
  }

  return response;
}
