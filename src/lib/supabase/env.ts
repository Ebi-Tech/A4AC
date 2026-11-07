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
 * Returns the service role key (SUPABASE_SERVICE_ROLE_KEY). Server only:
 * it bypasses Row Level Security.
 *
 * @returns The service role key string.
 */
export function supabaseServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}
