import Link from "next/link";
import { btnPrimary, btnSecondary, card, h2, muted } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

const TASKS = [
  { title: "Write", text: "Translate a short sentence into your language." },
  { title: "Speak", text: "Record yourself saying a sentence." },
  { title: "Transcribe", text: "Type out what someone else said." },
  { title: "Review", text: "Check other people's work." },
];

const STEPS = [
  "Everyone works from the same short English and French sentences.",
  "Other speakers of your language check each contribution.",
  "When independent reviewers agree, it is marked as verified.",
  "Verified work is published as a free, open dataset anyone can use to build tools for our languages.",
];

/**
 * Home page: what the project is, how contributions become open data, and a
 * "Start contributing" button (to sign-in for visitors).
 *
 * @param props.searchParams May contain "welcome" (just finished onboarding) or "account" = "deleted".
 * @returns The home page.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; account?: string }>;
}) {
  const { welcome, account } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-10">
      {welcome && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          You are all set. Thank you for joining!
        </p>
      )}
      {account === "deleted" && (
        <p role="status" className="rounded-xl bg-stone-200 px-4 py-3 dark:bg-stone-800">
          Your account and contributions have been deleted.
        </p>
      )}

      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Help computers understand your language</h1>
        <p className={`text-lg leading-relaxed ${muted}`}>
          A4AC is an open, volunteer-built collection of written and spoken sentences in African languages. Give a
          minute or an hour. Every sentence helps.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href={user ? "/contribute" : "/login"} className={btnPrimary}>
            Start contributing
          </Link>
          <Link href="/languages" className={btnSecondary}>
            See languages
          </Link>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className={h2}>
          Ways to help
        </h2>
        <ul className="grid grid-cols-2 gap-3">
          {TASKS.map((task) => (
            <li key={task.title} className={card}>
              <p className="font-semibold">{task.title}</p>
              <p className={`mt-1 text-sm ${muted}`}>{task.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="open-data-heading">
        <h2 id="open-data-heading" className={h2}>
          How your work becomes open data
        </h2>
        <ol className="space-y-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">
                {i + 1}
              </span>
              <span className="pt-1">{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
