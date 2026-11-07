import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";

config({ path: ".env.local" });
config();

const TABLES = [
  "profiles",
  "languages",
  "user_languages",
  "sentences",
  "translations",
  "recordings",
  "transcripts",
  "reviews",
  "review_history",
  "flags",
  "gold_samples",
];
const SEED_LANGUAGES = ["eng", "fra", "kin", "swh", "ibo", "yor", "hau"];

let failures = 0;

/**
 * Reads a required environment variable or exits with a helpful message.
 *
 * @param name The variable name.
 * @returns Its value.
 */
function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env.local and fill it in (see README).`);
    process.exit(1);
  }
  return value;
}

/**
 * Runs one named check and prints "ok" or "FAILED" with the reason.
 *
 * @param name  Human-readable check name.
 * @param check Async function that throws when the check fails.
 * @returns A promise that resolves once the line is printed.
 */
async function run(name: string, check: () => Promise<void>): Promise<void> {
  try {
    await check();
    console.log(`ok      ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAILED  ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Throws with the given message when the condition is false.
 *
 * @param condition Value that must be truthy.
 * @param message   Error message if it is not.
 */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Creates a confirmed throwaway user with the admin API and returns a client
 * signed in as that user (so RLS and triggers apply as for a real contributor).
 *
 * @param admin Service-role client.
 * @param label Short label used in the email address.
 * @returns The user's id and a signed-in anon-key client.
 */
async function createTestUser(admin: SupabaseClient, label: string) {
  const email = `verify-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);

  const client = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`sign-in failed: ${signIn.error.message}`);

  return { id: data.user.id, client };
}

/**
 * Entry point. Checks tables, seed data and the database rules, using two
 * temporary users that are deleted at the end.
 *
 * @returns A promise that resolves when all checks have run; exits non-zero on failure.
 */
async function main(): Promise<void> {
  const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const table of TABLES) {
    await run(`table ${table} exists`, async () => {
      const { error } = await admin.from(table).select("*", { count: "exact", head: true });
      assert(!error, error?.message ?? "");
    });
  }

  await run("seed languages present", async () => {
    const { data, error } = await admin.from("languages").select("iso_code, is_anchor").in("iso_code", SEED_LANGUAGES);
    assert(!error, error?.message ?? "");
    const found = new Set(data.map((l) => l.iso_code));
    const missing = SEED_LANGUAGES.filter((code) => !found.has(code));
    assert(missing.length === 0, `missing: ${missing.join(", ")}`);
    const anchors = data.filter((l) => l.is_anchor).map((l) => l.iso_code).sort();
    assert(anchors.join(",") === "eng,fra", `anchors are ${anchors.join(",")}`);
  });

  await run("seed sentences present (10)", async () => {
    const { count, error } = await admin
      .from("sentences")
      .select("*", { count: "exact", head: true })
      .eq("source", "project-seed");
    assert(!error, error?.message ?? "");
    assert(count === 10, `found ${count}`);
  });

  await run("storage bucket 'recordings' exists and is private", async () => {
    const { data, error } = await admin.storage.getBucket("recordings");
    assert(!error && data, error?.message ?? "not found");
    assert(data.public === false, "bucket is public");
  });

  const createdUsers: string[] = [];
  try {
    const author = await createTestUser(admin, "author");
    createdUsers.push(author.id);
    const reviewer = await createTestUser(admin, "reviewer");
    createdUsers.push(reviewer.id);

    const { data: sentence } = await admin.from("sentences").select("id").eq("source", "project-seed").limit(1).single();
    const { data: igbo } = await admin.from("languages").select("id").eq("iso_code", "ibo").single();
    assert(sentence && igbo, "seed data missing; cannot run rule checks");

    const { data: translation, error: insertError } = await author.client
      .from("translations")
      .insert({ sentence_id: sentence.id, language_id: igbo.id, contributor_id: author.id, text: "Ule ka tomato ndị a?" })
      .select("id, status")
      .single();
    assert(!insertError && translation, `could not insert test translation: ${insertError?.message}`);

    await run("self-review is blocked", async () => {
      const { error } = await author.client
        .from("reviews")
        .insert({ reviewer_id: author.id, target_type: "translation", target_id: translation.id, verdict: "same_meaning" });
      assert(error, "self-review was accepted");
      assert(/own contribution/.test(error.message), `unexpected error: ${error.message}`);
    });

    let reviewId = "";
    await run("second review by the same user is blocked", async () => {
      const first = await reviewer.client
        .from("reviews")
        .insert({ reviewer_id: reviewer.id, target_type: "translation", target_id: translation.id, verdict: "same_meaning" })
        .select("id")
        .single();
      assert(!first.error && first.data, `first review failed: ${first.error?.message}`);
      reviewId = first.data.id;

      const second = await reviewer.client
        .from("reviews")
        .insert({ reviewer_id: reviewer.id, target_type: "translation", target_id: translation.id, verdict: "different_meaning" });
      assert(second.error, "second review was accepted");
      assert(second.error.code === "23505", `unexpected error: ${second.error.code} ${second.error.message}`);
    });

    await run("editing a review updates the verdict and writes one review_history row", async () => {
      assert(reviewId, "no review to edit (previous check failed)");
      const { data, error } = await reviewer.client
        .from("reviews")
        .update({ verdict: "mostly_same" })
        .eq("id", reviewId)
        .select("verdict")
        .single();
      assert(!error && data, `update failed: ${error?.message}`);
      assert(data.verdict === "mostly_same", `verdict is ${data.verdict}`);

      const history = await admin.from("review_history").select("previous_verdict, new_verdict").eq("review_id", reviewId);
      assert(!history.error, history.error?.message ?? "");
      assert(history.data.length === 1, `expected 1 history row, found ${history.data.length}`);
      const [row] = history.data;
      assert(
        row.previous_verdict === "same_meaning" && row.new_verdict === "mostly_same",
        `history row is ${row.previous_verdict} -> ${row.new_verdict}`,
      );
    });

    await run("editing a verified translation resets it to pending", async () => {
      const promote = await admin.from("translations").update({ status: "verified" }).eq("id", translation.id);
      assert(!promote.error, `could not mark verified: ${promote.error?.message}`);

      const edit = await author.client
        .from("translations")
        .update({ text: "Ego ole ka tomato ndị a?" })
        .eq("id", translation.id);
      assert(!edit.error, `author edit failed: ${edit.error?.message}`);

      const { data, error } = await admin.from("translations").select("status, text").eq("id", translation.id).single();
      assert(!error && data, error?.message ?? "");
      assert(data.text === "Ego ole ka tomato ndị a?", "text was not updated");
      assert(data.status === "pending", `status is ${data.status}`);
    });
  } catch (err) {
    failures += 1;
    console.log(`FAILED  rule checks setup: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  }

  if (failures === 0) {
    console.log("all checks passed");
  } else {
    console.log(`${failures} check(s) FAILED`);
    process.exit(1);
  }
}

main();
