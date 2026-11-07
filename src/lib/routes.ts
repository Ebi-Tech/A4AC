const PUBLIC_PATHS = new Set(["/", "/languages", "/login"]);

/**
 * Tells whether a page can be viewed without signing in.
 *
 * @param pathname The request path, e.g. "/languages".
 * @returns True for the home, languages and login pages and the auth routes.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/auth/");
}

/**
 * Tells whether a signed-in user who has not finished onboarding may still
 * open this path (the onboarding page itself and the auth routes).
 *
 * @param pathname The request path.
 * @returns True if the onboarding redirect should be skipped.
 */
export function isOnboardingExempt(pathname: string): boolean {
  return pathname === "/onboarding" || pathname.startsWith("/auth/");
}

/**
 * Makes a "next" redirect target safe: only same-site paths are allowed, so
 * a crafted link cannot send people to another website after sign-in.
 *
 * @param next Raw value from a query string or form.
 * @returns The path if safe, otherwise "/".
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
