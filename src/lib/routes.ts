const PUBLIC_PATHS = new Set(["/", "/languages", "/login"]);
const PLACEHOLDER_ORIGIN = "http://internal.invalid";

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
 * Tells whether a path belongs to the admin area.
 *
 * @param pathname The request path.
 * @returns True for /admin and everything below it.
 */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
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
 * Makes a "next" redirect target safe: only paths on this site are allowed,
 * so a crafted link cannot send people to another website after sign-in.
 * Rejects absolute URLs, protocol-relative "//host", backslash tricks and
 * control characters, then confirms by parsing that the result stays on
 * this site.
 *
 * @param next Raw value from a query string or form.
 * @returns The path (with query and hash) if safe, otherwise "/".
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || next.length > 2000) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (/[\\\u0000-\u001F\u007F]/.test(next)) return "/";
  try {
    const url = new URL(next, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

/**
 * Encodes a path as base64url so it survives being embedded inside another
 * URL (the email link carries it through Supabase unchanged).
 *
 * @param path An internal path such as "/admin/sentences?page=2".
 * @returns The encoded value (letters, digits, "-" and "_" only).
 */
export function encodeNextParam(path: string): string {
  const bytes = new TextEncoder().encode(path);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes a value made by encodeNextParam and makes it safe.
 *
 * @param value The encoded value (may be null or malformed).
 * @returns A safe internal path, or "/" when missing or invalid.
 */
export function decodeNextParam(value: string | null | undefined): string {
  if (!value) return "/";
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return safeNextPath(new TextDecoder().decode(bytes));
  } catch {
    return "/";
  }
}
