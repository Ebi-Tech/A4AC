import Link from "next/link";
import { card, h1, muted } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";

/**
 * Admin overview: a few headline counts with links to the admin tools.
 *
 * @returns The overview page.
 */
export default async function AdminHome() {
  const { supabase } = await requireAdmin();

  const [active, inactive, requests, missingFrench, reports] = await Promise.all([
    supabase.from("sentences").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("sentences").select("*", { count: "exact", head: true }).eq("is_active", false),
    supabase.from("language_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.rpc("admin_anchor_list", { p_filter: "missing", p_limit: 1, p_offset: 0 }),
    supabase.from("sentence_reports").select("*", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const tiles = [
    { href: "/admin/sentences?status=active", label: "Active sentences", value: active.count ?? 0 },
    { href: "/admin/sentences?status=inactive", label: "Inactive sentences", value: inactive.count ?? 0 },
    { href: "/admin/anchors?filter=missing", label: "Without French", value: missingFrench.data?.[0]?.total_count ?? 0 },
    { href: "/admin/language-requests", label: "Language requests", value: requests.count ?? 0 },
    { href: "/admin/reports", label: "Open reports", value: reports.count ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <h1 className={h1}>Admin</h1>
      <ul className="grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <li key={tile.label}>
            <Link href={tile.href} className={`${card} block hover:border-emerald-700`}>
              <span className={`block text-sm ${muted}`}>{tile.label}</span>
              <span className="text-2xl font-bold tabular-nums">{tile.value}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className={`text-sm ${muted}`}>
        Large imports: <code>npm run import-sentences -- file.txt --source &quot;…&quot; --license &quot;…&quot;</code>
      </p>
    </div>
  );
}
