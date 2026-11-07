import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { ConsentText } from "@/components/consent-text";
import { DeleteAccountForm } from "@/components/delete-account-form";
import { DisplayNameForm } from "@/components/display-name-form";
import { LanguageRequestForm } from "@/components/language-request-form";
import { LanguagesForm } from "@/components/languages-form";
import { h1, muted } from "@/components/ui";
import { loadConsent } from "@/lib/consent";
import { loadLanguagePicker } from "@/lib/languages";
import { createClient } from "@/lib/supabase/server";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Getting started · A4AC" };

/**
 * Shows "Step n of 3" above each onboarding step.
 *
 * @param props.step Current step number.
 * @returns The step indicator.
 */
function StepLabel({ step }: { step: 1 | 2 | 3 }) {
  return <p className={`text-sm font-medium ${muted}`}>Step {step} of 3</p>;
}

/**
 * Onboarding, shown after first sign-in: 1 consent, 2 display name,
 * 3 languages. Users whose consent is out of date see only step 1. Users who
 * are done are sent home.
 *
 * @param props.searchParams "step" = "languages" moves past the name step.
 * @returns The current onboarding step.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  const { data: status } = await supabase.rpc("onboarding_status");
  if (status === "done") redirect("/");

  const signOutForm = (
    <div className="space-y-1 border-t border-stone-200 pt-4 dark:border-stone-800">
      <form action={signOut}>
        <button type="submit" className={`min-h-11 text-sm underline ${muted}`}>
          Not now, sign me out
        </button>
      </form>
      <DeleteAccountForm compact />
    </div>
  );

  if (status === "consent") {
    const consent = await loadConsent();
    return (
      <div className="space-y-6">
        <StepLabel step={1} />
        <ConsentText blocks={consent.blocks} />
        <ConsentForm version={consent.version} />
        {signOutForm}
      </div>
    );
  }

  const { step } = await searchParams;

  if (step === "languages") {
    const { languages, selected } = await loadLanguagePicker(supabase, user.id);
    return (
      <div className="space-y-6">
        <StepLabel step={3} />
        <h1 className={h1}>Your languages</h1>
        <LanguagesForm languages={languages} selected={selected} context="onboarding" />
        <LanguageRequestForm />
        {signOutForm}
      </div>
    );
  }

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  return (
    <div className="space-y-6">
      <StepLabel step={2} />
      <div className="space-y-2">
        <h1 className={h1}>What should we call you?</h1>
        <p className={muted}>Pick a name, or keep the anonymous one we made for you.</p>
      </div>
      <DisplayNameForm currentName={profile?.display_name ?? "Contributor"} context="onboarding" />
      {signOutForm}
    </div>
  );
}
