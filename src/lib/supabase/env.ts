/**
 * Reads a required environment variable and fails loudly if it is missing.
 *
 * @param name  Variable name, used in the error message.
 * @param value The value read from process.env (passed in so Next.js can inline
 *              NEXT_PUBLIC_* variables at build time).
 * @returns The non-empty value.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

/**
 * Returns the Supabase project URL (NEXT_PUBLIC_SUPABASE_URL).
 *
 * @returns The URL string.
 */
export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Returns the public anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY), safe to ship to browsers.
 *
 * @returns The anon key string.
 */
export function supabaseAnonKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Tells whether Google sign-in is configured. The button is hidden unless both
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
 *
 * @returns True when both Google provider keys are present.
 */
export function googleSignInEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Returns the public site URL used in auth redirects. Prefers
 * NEXT_PUBLIC_SITE_URL and falls back to the given request origin.
 *
 * @param requestOrigin Origin of the current request, if known.
 * @returns The site URL without a trailing slash.
 */
export function siteUrl(requestOrigin?: string | null): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL || requestOrigin || "http://localhost:3000";
  return url.replace(/\/$/, "");
}

/**
 * Returns the service role key (SUPABASE_SERVICE_ROLE_KEY). Server only:
 * it bypasses Row Level Security.
 *
 * @returns The service role key string.
 */
export function supabaseServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}
