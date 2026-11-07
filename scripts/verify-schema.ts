import {
  adminClient,
  assert,
  createTestUser,
  deleteTestUsers,
  fail,
  finish,
  run,
  seedIds,
} from "./lib/harness";

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
  "app_settings",
  "language_requests",
];
const SEED_LANGUAGES = ["eng", "fra", "kin", "swh", "ibo", "yor", "hau"];

/**
 * Checks tables, seed data and the core review rules from prompt 1, using
 * two temporary users (with valid consent) that are deleted at the end.
 *
 * @returns A promise that resolves when all checks have run.
 */
async function main(): Promise<void> {
  const admin = adminClient();

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
    const { sentenceId, languageId } = await seedIds(admin, "ibo");

    const { data: translation, error: insertError } = await author.client
      .from("translations")
      .insert({ sentence_id: sentenceId, language_id: languageId, contributor_id: author.id, text: "Ule ka tomato ndị a?" })
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
    fail("rule checks setup", err);
  } finally {
    await deleteTestUsers(admin, createdUsers);
  }

  finish();
}

main();
