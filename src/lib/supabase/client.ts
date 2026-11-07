import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * Creates a Supabase client for Client Components running in the browser.
 * Uses the public anon key, so every query is subject to Row Level Security
 * as the signed-in user (session is read from cookies).
 *
 * @returns A typed browser Supabase client.
 */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey());
}
