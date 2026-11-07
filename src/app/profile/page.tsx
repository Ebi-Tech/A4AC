import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DisplayNameForm } from "@/components/display-name-form";
import { LanguageRequestForm } from "@/components/language-request-form";
import { LanguagesForm } from "@/components/languages-form";
import { card, h1, h2, muted } from "@/components/ui";
import { loadLanguagePicker } from "@/lib/languages";
import { createClient } from "@/lib/supabase/server";
import { DeleteAccountForm } from "@/components/delete-account-form";
import { MyRecordings } from "./my-recordings";
import { MyTranslations } from "./my-translations";

export const metadata: Metadata = { title: "Your profile · A4AC" };

/**
 * Profile page: the user's contribution counts, their translations, display
 * name, languages, language requests and account deletion.
 *
 * @param props.searchParams "tpage" / "rpage" = page of "My translations" / "My recordings".
 * @returns The profile page.
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tpage?: string; rpage?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/profile");
  const query = await searchParams;
  const translationsPage = Math.max(1, Number.parseInt(query.tpage ?? "1", 10) || 1);
  const recordingsPage = Math.max(1, Number.parseInt(query.rpage ?? "1", 10) || 1);

  const [{ data: profile }, { data: counts }, picker] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).single(),
    supabase.rpc("my_contribution_counts").single(),
    loadLanguagePicker(supabase, user.id),
  ]);

  const stats = [
    { label: "Translations", value: counts?.translations ?? 0 },
    { label: "Recordings", value: counts?.recordings ?? 0 },
    { label: "Transcripts", value: counts?.transcripts ?? 0 },
    { label: "Reviews", value: counts?.reviews ?? 0 },
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className={h1}>{profile?.display_name}</h1>
        <p className={`text-sm ${muted}`}>Signed in as {user.email}. Only you can see this.</p>
      </div>

      <section aria-labelledby="counts-heading" className="space-y-3">
        <h2 id="counts-heading" className={h2}>
          Your contributions
        </h2>
        <dl className="grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label} className={card}>
              <dt className={`text-sm ${muted}`}>{s.label}</dt>
              <dd className="text-2xl font-bold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <MyTranslations userId={user.id} page={translationsPage} />

      <MyRecordings userId={user.id} page={recordingsPage} />

      <section aria-labelledby="name-heading" className="space-y-3">
        <h2 id="name-heading" className={h2}>
          Display name
        </h2>
        <DisplayNameForm currentName={profile?.display_name ?? ""} context="profile" />
      </section>

      <section aria-labelledby="languages-heading" className="space-y-3">
        <h2 id="languages-heading" className="sr-only">
          Languages
        </h2>
        <LanguagesForm languages={picker.languages} selected={picker.selected} context="profile" />
        <LanguageRequestForm />
      </section>

      <section aria-labelledby="account-heading" className="space-y-3">
        <h2 id="account-heading" className={h2}>
          Account
        </h2>
        <DeleteAccountForm />
      </section>
    </div>
  );
}
