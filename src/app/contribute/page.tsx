import type { Metadata } from "next";
import Link from "next/link";
import { btnSecondary, h1, muted } from "@/components/ui";

export const metadata: Metadata = { title: "Contribute · A4AC" };

/**
 * Placeholder for the contribution tasks (write, speak, transcribe, review),
 * which are built in later prompts. Only reachable after onboarding.
 *
 * @returns The placeholder page.
 */
export default function ContributePage() {
  return (
    <div className="space-y-4">
      <h1 className={h1}>Contribute</h1>
      <p className={muted}>
        Writing, speaking, transcribing and reviewing are coming very soon. Thank you for signing up early!
      </p>
      <Link href="/profile" className={btnSecondary}>
        Go to your profile
      </Link>
    </div>
  );
}
