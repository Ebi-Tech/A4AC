import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * Creates a Supabase client for Server Components, Server Actions and Route
 * Handlers. It acts as the signed-in user (session from request cookies), so
 * Row Level Security applies.
 *
 * Cookie writes are ignored when called from a Server Component, where Next.js
 * forbids setting cookies; the middleware refreshes the session instead.
 *
 * @returns A promise resolving to a server Supabase client.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* Called from a Server Component; middleware handles the refresh. */
        }
      },
    },
  });
}
