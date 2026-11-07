import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Admin · A4AC", robots: { index: false, follow: false } };

const LINKS = [
  { href: "/admin", text: "Overview" },
  { href: "/admin/sentences", text: "Sentences" },
  { href: "/admin/anchors", text: "French anchors" },
  { href: "/admin/language-requests", text: "Language requests" },
  { href: "/admin/reports", text: "Reports" },
  { href: "/admin/languages", text: "Languages" },
];

/**
 * Layout for every admin page. Checks on the server that the visitor is an
 * admin (others get a 404) and shows the admin navigation.
 *
 * @param props.children The admin page.
 * @returns The admin shell.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <nav aria-label="Admin" className="-mx-1 flex flex-wrap gap-1 border-b border-stone-200 pb-3 dark:border-stone-800">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-stone-200/60 dark:hover:bg-stone-800"
          >
            {link.text}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
