import { approveLanguageRequest, declineLanguageRequest } from "@/app/admin/actions";
import { ActionForm } from "@/components/action-form";
import { btnPrimary, btnSecondary, card, h1, h2, input, label, muted } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Language requests: approve a pending request (creates the language) or
 * decline it. Recently resolved requests are listed below.
 *
 * @returns The language requests page.
 */
export default async function AdminLanguageRequestsPage() {
  const { supabase } = await requireAdmin();

  const [{ data: pending }, { data: resolved }] = await Promise.all([
    supabase
      .from("language_requests")
      .select("id, name, iso_code, note, created_at, profiles(display_name)")
      .eq("status", "pending")
      .order("created_at"),
    supabase
      .from("language_requests")
      .select("id, name, iso_code, status, updated_at")
      .neq("status", "pending")
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div className="space-y-8">
      <h1 className={h1}>Language requests</h1>

      <section className="space-y-3" aria-labelledby="pending-heading">
        <h2 id="pending-heading" className={h2}>
          Waiting ({pending?.length ?? 0})
        </h2>
        {pending?.length === 0 && <p className={muted}>No pending requests.</p>}
        <ul className="space-y-3">
          {pending?.map((request) => (
            <li key={request.id} className={`${card} space-y-4`}>
              <div>
                <p className="text-lg font-semibold">{request.name}</p>
                <p className={`text-sm ${muted}`}>
                  {request.iso_code ? `Code ${request.iso_code} · ` : ""}
                  from {request.profiles?.display_name ?? "a contributor"} · {dateFormat.format(new Date(request.created_at))}
                </p>
                {request.note && <p className="mt-2">{request.note}</p>}
              </div>

              <ActionForm action={approveLanguageRequest} className="space-y-3">
                <input type="hidden" name="request_id" value={request.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`name-${request.id}`} className={label}>
                      Name
                    </label>
                    <input id={`name-${request.id}`} name="name" required defaultValue={request.name} className={input} />
                  </div>
                  <div>
                    <label htmlFor={`iso-${request.id}`} className={label}>
                      ISO 639-3 code
                    </label>
                    <input
                      id={`iso-${request.id}`}
                      name="iso_code"
                      required
                      maxLength={3}
                      defaultValue={request.iso_code ?? ""}
                      autoCapitalize="none"
                      className={input}
                    />
                  </div>
                  <div>
                    <label htmlFor={`native-${request.id}`} className={label}>
                      Native name <span className={`font-normal ${muted}`}>(optional)</span>
                    </label>
                    <input id={`native-${request.id}`} name="native_name" className={input} />
                  </div>
                  <div>
                    <label htmlFor={`status-${request.id}`} className={label}>
                      Status
                    </label>
                    <select id={`status-${request.id}`} name="status" defaultValue="open" className={input}>
                      <option value="open">Open</option>
                      <option value="waiting_for_contributors">Waiting for contributors</option>
                    </select>
                  </div>
                </div>
                <button type="submit" className={btnPrimary}>
                  Approve and add language
                </button>
              </ActionForm>

              <ActionForm action={declineLanguageRequest}>
                <input type="hidden" name="request_id" value={request.id} />
                <button type="submit" className={btnSecondary}>
                  Decline
                </button>
              </ActionForm>
            </li>
          ))}
        </ul>
      </section>

      {resolved && resolved.length > 0 && (
        <section className="space-y-3" aria-labelledby="resolved-heading">
          <h2 id="resolved-heading" className={h2}>
            Recently resolved
          </h2>
          <ul className={`space-y-1 ${muted}`}>
            {resolved.map((request) => (
              <li key={request.id}>
                {request.name}
                {request.iso_code ? ` (${request.iso_code})` : ""}: {request.status} on{" "}
                {dateFormat.format(new Date(request.updated_at))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
