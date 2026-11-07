import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side admin check for admin pages and actions. Anyone who is not a
 * signed-in admin gets the normal 404 page, so the admin area stays hidden.
 * This runs in addition to the middleware check and the database's own
 * admin-only rules.
 *
 * @returns A server Supabase client acting as the admin, and the admin's user id.
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  return { supabase, userId: user.id };
}
