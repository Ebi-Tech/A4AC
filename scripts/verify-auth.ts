import { readFile } from "node:fs/promises";
import { deleteAccountAndFiles } from "../src/lib/account-deletion";
import {
  adminClient,
  assert,
  createTestUser,
  deleteTestUsers,
  fail,
  finish,
  run,
  seedIds,
  type TestUser,
} from "./lib/harness";

const CONSENT_BLOCKED = /consent/i;

/**
 * Checks the prompt-2 rules: consent enforcement, stale reviews after text
 * edits, account deletion (rows and audio files) and language requests. Uses
 * temporary users that are deleted at the end.
 *
 * @returns A promise that resolves when all checks have run.
 */
async function main(): Promise<void> {
  const admin = adminClient();
  const createdUsers: string[] = [];

  /**
   * Creates a test user and remembers it for cleanup.
   *
   * @param label   Label for the email address.
   * @param consent Whether the user accepts the current consent.
   * @returns The signed-in test user.
   */
  const user = async (label: string, consent = true): Promise<TestUser> => {
    const created = await createTestUser(admin, label, { consent });
    createdUsers.push(created.id);
    return created;
  };

  try {
    await run("content/consent.md version matches app_settings.current_consent_version", async () => {
      const source = await readFile("content/consent.md", "utf8");
      const fileVersion = /^version:\s*(.+)$/m.exec(source)?.[1]?.trim();
      const { data } = await admin.from("app_settings").select("current_consent_version").single();
      assert(fileVersion, "consent.md has no version line");
      assert(data?.current_consent_version === fileVersion, `file ${fileVersion} vs database ${data?.current_consent_version}`);
    });

    const { sentenceId, languageId } = await seedIds(admin, "ibo");
    const author = await user("author");
    const reviewer = await user("reviewer");
    const noConsent = await user("noconsent", false);
    const outdated = await user("outdated");

    let translationId = "";
    await run("a user with valid consent can insert a translation", async () => {
      const { data, error } = await author.client
        .from("translations")
        .insert({ sentence_id: sentenceId, language_id: languageId, contributor_id: author.id, text: "Kedu ka ị mere?" })
        .select("id, status")
        .single();
      assert(!error && data, `insert failed: ${error?.message}`);
      assert(data.status === "pending", `status is ${data.status}`);
      translationId = data.id;
    });

    await run("a user without consent cannot insert a translation, review or flag", async () => {
      assert(translationId, "no target translation (previous check failed)");
      const translation = await noConsent.client
        .from("translations")
        .insert({ sentence_id: sentenceId, language_id: languageId, contributor_id: noConsent.id, text: "Ndewo" });
      assert(translation.error && CONSENT_BLOCKED.test(translation.error.message), "translation insert was not blocked");

      const review = await noConsent.client
        .from("reviews")
        .insert({ reviewer_id: noConsent.id, target_type: "translation", target_id: translationId, verdict: "same_meaning" });
      assert(review.error && CONSENT_BLOCKED.test(review.error.message), "review insert was not blocked");

      const flag = await noConsent.client
        .from("flags")
        .insert({ flagger_id: noConsent.id, target_type: "translation", target_id: translationId, reason: "test" });
      assert(flag.error && CONSENT_BLOCKED.test(flag.error.message), "flag insert was not blocked");
    });

    await run("a user with an outdated consent_version is blocked", async () => {
      const downgrade = await admin.from("profiles").update({ consent_version: "2000-01-01" }).eq("id", outdated.id);
      assert(!downgrade.error, `could not set old version: ${downgrade.error?.message}`);
      const { error } = await outdated.client
        .from("translations")
        .insert({ sentence_id: sentenceId, language_id: languageId, contributor_id: outdated.id, text: "Ndewo nụ" });
      assert(error && CONSENT_BLOCKED.test(error.message), "insert with outdated consent was not blocked");
    });

    await run("users cannot set consent fields directly", async () => {
      const { error } = await noConsent.client
        .from("profiles")
        .update({ consent_accepted_at: new Date().toISOString(), is_adult_confirmed: true })
        .eq("id", noConsent.id);
      assert(error, "direct consent update was accepted");
    });

    await run("editing a translation's text resets status to pending and marks its reviews stale", async () => {
      assert(translationId, "no translation (previous check failed)");
      const review = await reviewer.client
        .from("reviews")
        .insert({ reviewer_id: reviewer.id, target_type: "translation", target_id: translationId, verdict: "same_meaning" })
        .select("id")
        .single();
      assert(!review.error && review.data, `review failed: ${review.error?.message}`);

      const mark = await admin.from("translations").update({ status: "unverified" }).eq("id", translationId);
      assert(!mark.error, `could not mark unverified: ${mark.error?.message}`);

      const edit = await author.client.from("translations").update({ text: "Kedu ka ị mere taa?" }).eq("id", translationId);
      assert(!edit.error, `edit failed: ${edit.error?.message}`);

      const { data: t } = await admin.from("translations").select("status").eq("id", translationId).single();
      assert(t?.status === "pending", `status is ${t?.status}`);

      const { data: r } = await admin.from("reviews").select("is_stale").eq("id", review.data.id).single();
      assert(r?.is_stale === true, "review was not marked stale");

      const { data: votes } = await admin
        .from("review_votes")
        .select("votes")
        .eq("target_type", "translation")
        .eq("target_id", translationId);
      assert((votes ?? []).length === 0, "stale review is still counted in review_votes");

      const revote = await reviewer.client.from("reviews").update({ verdict: "same_meaning" }).eq("id", review.data.id);
      assert(!revote.error, `re-vote failed: ${revote.error?.message}`);
      const { data: fresh } = await admin.from("reviews").select("is_stale").eq("id", review.data.id).single();
      assert(fresh?.is_stale === false, "re-voting did not clear is_stale");
    });

    await run("language_requests insert works and status starts as pending", async () => {
      const { data, error } = await author.client
        .from("language_requests")
        .insert({ requester_id: author.id, name: "Luganda", iso_code: "lug", status: "added" })
        .select("status")
        .single();
      assert(!error && data, `insert failed: ${error?.message}`);
      assert(data.status === "pending", `status is ${data.status}`);
    });

    await run("deleting a user removes their rows and their files in the recordings bucket", async () => {
      const doomed = await user("delete");
      const audioPath = `${doomed.id}/test-${Date.now()}.webm`;

      const upload = await doomed.client.storage
        .from("recordings")
        .upload(audioPath, new Blob([new Uint8Array([26, 69, 223, 163])], { type: "audio/webm" }), {
          contentType: "audio/webm",
        });
      assert(!upload.error, `upload failed: ${upload.error?.message}`);

      const recording = await doomed.client.from("recordings").insert({
        sentence_id: sentenceId,
        language_id: languageId,
        contributor_id: doomed.id,
        mode: "translate_and_speak",
        storage_path: audioPath,
        duration_ms: 1200,
      });
      assert(!recording.error, `recording insert failed: ${recording.error?.message}`);

      const translation = await doomed.client
        .from("translations")
        .insert({ sentence_id: sentenceId, language_id: languageId, contributor_id: doomed.id, text: "Daalụ" });
      assert(!translation.error, `translation insert failed: ${translation.error?.message}`);

      const { filesRemoved } = await deleteAccountAndFiles(admin, doomed.id);
      assert(filesRemoved === 1, `expected 1 file removed, got ${filesRemoved}`);

      const files = await admin.storage.from("recordings").list(doomed.id);
      assert(!files.error && files.data.length === 0, `files left in bucket: ${files.data?.length}`);

      for (const [table, column] of [
        ["profiles", "id"],
        ["recordings", "contributor_id"],
        ["translations", "contributor_id"],
      ] as const) {
        const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq(column, doomed.id);
        assert(count === 0, `${count} row(s) left in ${table}`);
      }

      const { data: authUser } = await admin.auth.admin.getUserById(doomed.id);
      assert(!authUser?.user, "auth user still exists");
    });
  } catch (err) {
    fail("setup", err);
  } finally {
    await deleteTestUsers(admin, createdUsers);
  }

  finish();
}

main();
