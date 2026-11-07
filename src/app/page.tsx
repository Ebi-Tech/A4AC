/**
 * Placeholder home page. Explains the project in one paragraph until the
 * contribution flows are built.
 *
 * @returns The home page markup.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">A4AC</h1>
      <p className="text-lg leading-relaxed text-neutral-600 dark:text-neutral-300">
        An open, volunteer-built collection of speech and translation data for African languages. Everyone works
        from the same bank of sentences, so every language can be paired with every other.
      </p>
      <ul className="grid gap-2 text-neutral-700 sm:grid-cols-2 dark:text-neutral-200">
        <li className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">Write a translation</li>
        <li className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">Speak a sentence</li>
        <li className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">Transcribe a recording</li>
        <li className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">Review contributions</li>
      </ul>
      <p className="text-sm text-neutral-500">Coming soon.</p>
    </main>
  );
}
