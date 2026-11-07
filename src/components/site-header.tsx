import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";

const navLink =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-base font-medium hover:bg-stone-200/60 dark:hover:bg-stone-800";

/**
 * Site header with the project name and navigation. Shows "Sign in" to
 * visitors, "Profile" plus "Sign out" to signed-in users, and "Admin" to admins.
 *
 * @returns The header element.
 */
export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAdmin = user ? (await supabase.rpc("is_admin")).data === true : false;

  return (
    <header className="border-b border-stone-200 dark:border-stone-800">
      <nav className="mx-auto flex max-w-xl flex-wrap items-center gap-1 px-2 py-2" aria-label="Main">
        <Link href="/" className="mr-auto inline-flex min-h-11 items-center px-2 text-lg font-bold">
          A4AC
        </Link>
        <Link href="/languages" className={navLink}>
          Languages
        </Link>
        {user ? (
          <>
            {isAdmin && (
              <Link href="/admin" className={navLink}>
                Admin
              </Link>
            )}
            <Link href="/profile" className={navLink}>
              Profile
            </Link>
            <form action={signOut}>
              <button type="submit" className={navLink}>
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link href="/login" className={navLink}>
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
