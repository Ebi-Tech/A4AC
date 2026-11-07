import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, assert, createTestUser, deleteTestUsers, env, fail, finish, run, type TestUser } from "./lib/harness";
import { Browser, ensureApp, type App } from "./lib/http";

const TEST_LANGUAGE = "qaa";
const TEST_SENTENCES = 66;
const PERF_SENTENCES = 30_000;
const PERF_SKIPS = 3_000;
const PERF_LIMIT_MS = 20;

type QueueItem = { sentence_id: string; anchor_text: string; anchor_language_id: string; anchor_iso_code: string };

/**
 * Turns a number into letters (0 → "a", 26 → "ba") so generated test
 * translations contain no digits.
 *
 * @param n A non-negative integer.
 * @returns The letter code.
 */
function letters(n: number): string {
  let out = "";
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  return out;
}

/**
 * Inserts a translation as the given user and returns the error, if any.
 *
 * @param user       The signed-in test user.
 * @param sentenceId Sentence translated.
 * @param languageId Target language.
 * @param seenId     Anchor language shown.
 * @param text       The translation.
 * @returns The Supabase error (null on success).
 */
async function write(user: TestUser, sentenceId: string, languageId: string, seenId: string, text: string) {
  const { error } = await user.client.from("translations").insert({
    sentence_id: sentenceId,
    language_id: languageId,
    seen_anchor_language_id: seenId,
    contributor_id: user.id,
    text,
  });
  return error;
}

/**
 * Calls next_sentence_for_write as the given user.
 *
 * @param user       The signed-in test user.
 * @param languageId Target language.
 * @returns The next item, or null.
 */
async function nextFor(user: TestUser, languageId: string): Promise<QueueItem | null> {
  const { data, error } = await user.client.rpc("next_sentence_for_write", { p_language_id: languageId });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

/**
 * Removes the test language and anything left in it from an earlier run.
 *
 * @param admin Service-role client.
 */
async function removeTestLanguage(admin: SupabaseClient): Promise<void> {
  const { data } = await admin.from("languages").select("id").eq("iso_code", TEST_LANGUAGE).maybeSingle();
  if (!data) return;
  await admin.from("sentence_skips").delete().eq("language_id", data.id);
  await admin.from("translations").delete().eq("language_id", data.id);
  await admin.from("recordings").delete().eq("language_id", data.id);
  await admin.from("languages").delete().eq("id", data.id);
}

/**
 * Inserts rows in batches through the service role.
 *
 * @param admin Service-role client.
 * @param table Table name.
 * @param rows  Rows to insert.
 * @param size  Batch size.
 */
async function insertInBatches(admin: SupabaseClient, table: string, rows: object[], size = 1000): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

/**
 * Deletes every sentence from a source in small batches, so no single
 * statement runs into the API's statement timeout.
 *
 * @param admin  Service-role client.
 * @param source The sentences' source label.
 */
async function deleteSentencesBySource(admin: SupabaseClient, source: string): Promise<void> {
  for (;;) {
    const { data } = await admin.from("sentences").select("id").eq("source", source).limit(100);
    if (!data?.length) return;
    const { error } = await admin.from("sentences").delete().in("id", data.map((s) => s.id));
    if (error) throw new Error(`cleanup failed: ${error.message}`);
  }
}

/**
 * Checks the prompt-4 WRITE task: saving, every validation rule, the rate
 * limit, skips and reports, language permissions, the hub, and queue speed.
 * Uses temporary users, a temporary test language ("qaa"), temporary
 * sentences, and the running app (started if needed).
 *
 * @returns A promise that resolves when all checks have run.
 */
async function main(): Promise<void> {
  const admin = adminClient();
  const createdUsers: string[] = [];
  const source = `verify-write-${Date.now()}`;
  const perfSource = `verify-perf-${Date.now()}`;
  let app: App | null = null;

  /**
   * Creates a test user, marks them onboarded and remembers them for cleanup.
   *
   * @param label   Label for the email address.
   * @param options Consent, anchor and spoken languages.
   * @returns The signed-in test user.
   */
  const user = async (label: string, options: { anchors?: string[]; speaks?: string[] } = {}) => {
    const created = await createTestUser(admin, label, options);
    createdUsers.push(created.id);
    await admin.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", created.id);
    return created;
  };

  try {
    await removeTestLanguage(admin);
    const { data: lang, error: langError } = await admin
      .from("languages")
      .insert({ iso_code: TEST_LANGUAGE, name: "Verify write language", is_anchor: false, status: "open" })
      .select("id")
      .single();
    assert(!langError && lang, `could not create test language: ${langError?.message}`);
    const qaa = lang.id;
    const { data: anchors } = await admin.from("languages").select("id, iso_code").in("iso_code", ["eng", "ibo"]);
    const eng = anchors!.find((l) => l.iso_code === "eng")!.id;

    const { data: eng2 } = await admin.from("languages").select("id").eq("iso_code", "eng").single();
    const { data: sentences, error: sentError } = await admin
      .from("sentences")
      .insert(
        Array.from({ length: TEST_SENTENCES }, (_, i) => ({
          anchor_language_id: eng2!.id,
          text: `Write check sentence ${letters(i)} for testing`,
          source,
          source_license: "CC0-1.0",
        })),
      )
      .select("id, text");
    assert(!sentError && sentences, `could not create test sentences: ${sentError?.message}`);
    const [ruleSentence, dupSentence, skipSentence, reportSentence, ...rest] = sentences;
    const rateSentences = rest.slice(0, 61);
    assert(rateSentences.length === 61, "not enough test sentences");

    app = await ensureApp();
    const writer = await user("writer", { speaks: [TEST_LANGUAGE] });
    const browser = new Browser(app.baseUrl);
    await browser.signIn(admin, writer.email);

    await run("a valid translation (sent through the app) saves as pending with the correct seen_anchor_language_id", async () => {
      const item = await nextFor(writer, qaa);
      assert(item, "queue returned nothing");
      const result = (await browser.callAction(`/contribute/${TEST_LANGUAGE}/write`, "submitTranslation", [
        {
          languageId: qaa,
          sentenceId: item.sentence_id,
          seenAnchorLanguageId: item.anchor_language_id,
          text: "Nke a bụ ntụgharị ziri ezi",
          exclude: [item.sentence_id],
        },
      ])) as { ok: boolean; error?: string; following?: QueueItem | null };
      assert(result.ok, `action failed: ${result.error}`);
      assert(result.following && result.following.sentence_id !== item.sentence_id, "no different next sentence returned");

      const { data: row } = await admin
        .from("translations")
        .select("status, seen_anchor_language_id, text")
        .eq("contributor_id", writer.id)
        .eq("sentence_id", item.sentence_id)
        .single();
      assert(row?.status === "pending", `status is ${row?.status}`);
      assert(row?.seen_anchor_language_id === eng && item.anchor_language_id === eng, "seen anchor is not English");
    });

    await run("each validation rule rejects with its own friendly error", async () => {
      const cases: [string, string][] = [
        ["   ", "empty"],
        [ruleSentence.text, "copy"],
        [ruleSentence.text.toUpperCase().replace(/ /g, "  ") + "!", "copy"],
        ["Gaa na www.example.com maka nke a", "contact"],
        ["Zitere m ozi na onye@example.com ugbu a", "contact"],
        ["Kpọọ m na 0803 123 4567 ugbu a biko", "contact"],
        ["Ọ dị ogologo ".repeat(12), "too_long"],
        ["Ee", "too_short"],
      ];
      const messages = new Map<string, string>();
      for (const [text, rule] of cases) {
        const error = await write(writer, ruleSentence.id, qaa, eng, text);
        assert(error, `"${text.slice(0, 30)}" was accepted (expected ${rule})`);
        assert(error.hint === rule, `"${text.slice(0, 30)}" gave ${error.hint}, expected ${rule}`);
        assert(!/violat|constraint|null value/i.test(error.message), `unfriendly message: ${error.message}`);
        messages.set(rule, error.message);
      }
      assert(new Set(messages.values()).size === messages.size, "two rules share the same message");
      const ok = await write(writer, ruleSentence.id, qaa, eng, "Ahịrịokwu a dị mma nke ukwuu");
      assert(!ok, `a valid text was rejected after the failures: ${ok?.message}`);
    });

    await run("a second translation of the same sentence and language by the same user is rejected", async () => {
      const first = await write(writer, dupSentence.id, qaa, eng, "Nke mbụ m dere ebe a");
      assert(!first, `first failed: ${first?.message}`);
      const second = await write(writer, dupSentence.id, qaa, eng, "Nke abụọ m dere ebe a");
      assert(second?.hint === "duplicate", `second gave ${second?.hint ?? "no error"}`);
    });

    await run("the 61st translation inside 10 minutes is blocked with a 'take a break' message", async () => {
      const busy = await user("busy", { speaks: [TEST_LANGUAGE] });
      for (let i = 0; i < 60; i++) {
        const error = await write(busy, rateSentences[i].id, qaa, eng, `Ntụgharị nke ${letters(i)} maka ule`);
        assert(!error, `translation ${i + 1} failed: ${error?.message}`);
      }
      const error = await write(busy, rateSentences[60].id, qaa, eng, "Ntụgharị ikpeazụ maka ule");
      assert(error?.hint === "rate_limit", `61st gave ${error?.hint ?? "no error"}`);
      assert(/break/i.test(error.message), `message is not friendly: ${error.message}`);
    });

    const helper = await user("helper", { speaks: [TEST_LANGUAGE] });
    const { data: active } = await admin.from("sentences").select("id").eq("is_active", true);
    const cover = (active ?? [])
      .filter((s) => s.id !== skipSentence.id && s.id !== reportSentence.id)
      .map((s) => ({ sentence_id: s.id, language_id: qaa, seen_anchor_language_id: eng, contributor_id: helper.id, text: `cover ${s.id}` }));
    await insertInBatches(admin, "translations", cover);

    await run("a skipped sentence does not come back to that user for 7 days, but still comes to other users", async () => {
      const skipper = await user("skipper", { speaks: [TEST_LANGUAGE] });
      const other = await user("other", { speaks: [TEST_LANGUAGE] });
      await admin.from("sentence_skips").insert({ user_id: other.id, sentence_id: reportSentence.id, language_id: qaa, reason: "not_sure" });
      await admin.from("sentence_skips").insert({ user_id: skipper.id, sentence_id: reportSentence.id, language_id: qaa, reason: "not_sure" });

      const before = await nextFor(skipper, qaa);
      assert(before?.sentence_id === skipSentence.id, "setup: the least-covered sentence was not offered first");

      const skip = await skipper.client
        .from("sentence_skips")
        .insert({ user_id: skipper.id, sentence_id: skipSentence.id, language_id: qaa, reason: "not_sure" })
        .select("id")
        .single();
      assert(!skip.error && skip.data, `skip failed: ${skip.error?.message}`);

      for (let i = 0; i < 10; i++) {
        const item = await nextFor(skipper, qaa);
        assert(item && item.sentence_id !== skipSentence.id, "skipped sentence came back immediately");
      }
      const forOther = await nextFor(other, qaa);
      assert(forOther?.sentence_id === skipSentence.id, "another user no longer gets the sentence");

      await admin.from("sentence_skips").update({ created_at: new Date(Date.now() - 6 * 86400_000).toISOString() }).eq("id", skip.data.id);
      const sixDays = await nextFor(skipper, qaa);
      assert(sixDays?.sentence_id !== skipSentence.id, "came back after only 6 days");

      await admin.from("sentence_skips").update({ created_at: new Date(Date.now() - 8 * 86400_000).toISOString() }).eq("id", skip.data.id);
      const eightDays = await nextFor(skipper, qaa);
      assert(eightDays?.sentence_id === skipSentence.id, "did not come back after 8 days");
    });

    await run("a reported sentence (sent through the app) appears on the admin reports list", async () => {
      const result = (await browser.callAction(`/contribute/${TEST_LANGUAGE}/write`, "skipSentence", [
        { languageId: qaa, sentenceId: reportSentence.id, reason: "report", note: "Verify: unclear wording", exclude: [] },
      ])) as { ok: boolean; error?: string };
      assert(result.ok, `report failed: ${result.error}`);

      const { data: rows } = await admin.from("sentence_reports").select("status, reason").eq("sentence_id", reportSentence.id);
      assert(rows?.some((r) => r.status === "open" && r.reason === "Verify: unclear wording"), "no open report row");

      const boss = await user("boss");
      await admin.from("profiles").update({ role: "admin" }).eq("id", boss.id);
      const adminBrowser = new Browser(app!.baseUrl);
      await adminBrowser.signIn(admin, boss.email);
      const page = await adminBrowser.get("/admin/reports");
      assert(page.status === 200 && page.body.includes(reportSentence.text), "report not shown on /admin/reports");
      assert(page.body.includes("Verify: unclear wording"), "report reason not shown");
    });

    await run("users cannot write into a language they did not list as spoken, or into one that is not open", async () => {
      const igboOnly = await user("igboonly", { speaks: ["ibo"] });
      const notSpoken = await write(igboOnly, ruleSentence.id, qaa, eng, "Ahịrịokwu a dị mma nke ukwuu");
      assert(notSpoken?.hint === "not_spoken", `not spoken gave ${notSpoken?.hint ?? "no error"}`);
      assert((await nextFor(igboOnly, qaa)) === null, "queue offered a language the user does not speak");

      await admin.from("languages").update({ status: "waiting_for_contributors" }).eq("id", qaa);
      try {
        const closed = await write(writer, rest[61].id, qaa, eng, "Ahịrịokwu ọzọ dị mma nke ukwuu");
        assert(closed?.hint === "language_closed", `closed language gave ${closed?.hint ?? "no error"}`);
        assert((await nextFor(writer, qaa)) === null, "queue offered a closed language");
        const page = await browser.get(`/contribute/${TEST_LANGUAGE}/write`);
        assert(!page.body.includes("Write this in"), "write page still offered a closed language");
      } finally {
        await admin.from("languages").update({ status: "open" }).eq("id", qaa);
      }
    });

    await run("the hub only lists open languages the user speaks, and the write page shows the sentence and letters", async () => {
      const multi = await user("multi", { speaks: ["ibo", "yor", "hau"] });
      const { data: kin } = await admin.from("languages").select("id").eq("iso_code", "kin").single();
      await multi.client.from("user_languages").insert({ user_id: multi.id, language_id: kin!.id, ability: "understands" });
      await admin.from("languages").update({ status: "waiting_for_contributors" }).eq("iso_code", "hau");
      try {
        const b = new Browser(app!.baseUrl);
        await b.signIn(admin, multi.email);
        const hub = await b.get("/contribute");
        assert(hub.status === 200, `hub status ${hub.status}`);
        assert(hub.body.includes('data-language="ibo"') && hub.body.includes('data-language="yor"'), "spoken open languages missing");
        assert(!hub.body.includes('data-language="hau"'), "closed language listed");
        assert(!hub.body.includes('data-language="kin"'), "a language the user only understands is listed");

        const page = await b.get("/contribute/ibo/write");
        assert(page.body.includes("Write this in Igbo"), "write page has no prompt");
        assert(page.body.includes("Insert ị"), "Igbo letters missing");
        assert(page.body.includes(">English<"), "anchor language label missing");
      } finally {
        await admin.from("languages").update({ status: "open" }).eq("iso_code", "hau");
      }
    });

    const local = /127\.0\.0\.1|localhost/.test(env("NEXT_PUBLIC_SUPABASE_URL"));
    if (local || process.env.VERIFY_PERF === "1") {
      await run(`queue speed under ${PERF_LIMIT_MS} ms with ${PERF_SENTENCES.toLocaleString()} sentences and ${PERF_SKIPS.toLocaleString()} skips`, async () => {
        const perfUser = await user("perf", { speaks: [TEST_LANGUAGE] });
        const french = await user("perffr", { anchors: ["fra"], speaks: [TEST_LANGUAGE] });
        await insertInBatches(
          admin,
          "sentences",
          Array.from({ length: PERF_SENTENCES }, (_, i) => ({
            anchor_language_id: eng,
            text: `Perf sentence ${letters(i)} about the busy market`,
            source: perfSource,
            source_license: "test",
          })),
          250,
        );
        const { data: perfIds } = await admin.from("sentences").select("id").eq("source", perfSource).limit(PERF_SKIPS);
        await insertInBatches(
          admin,
          "sentence_skips",
          (perfIds ?? []).map((s) => ({ user_id: perfUser.id, sentence_id: s.id, language_id: qaa, reason: "not_sure" })),
        );

        /**
         * Times the queue in the database for one user and task.
         *
         * @param who  The user to act as.
         * @param task "write" or "speak".
         * @returns Average milliseconds per call.
         */
        const time = async (who: TestUser, task: string) => {
          const { data, error } = await admin.rpc("benchmark_next_sentence", {
            p_user: who.id,
            p_language_id: qaa,
            p_task: task,
            p_runs: 20,
          });
          if (error) throw new Error(error.message);
          return Number(data);
        };

        const results: string[] = [];
        for (const [label, who, task] of [
          ["write, English reader", perfUser, "write"],
          ["speak, English reader", perfUser, "speak"],
          ["write, French-only reader", french, "write"],
        ] as const) {
          const ms = await time(who, task);
          results.push(`${label} ${ms} ms`);
          assert(ms < PERF_LIMIT_MS, `${label}: ${ms} ms`);
        }

        const { error: coverError } = await admin
          .from("sentence_coverage")
          .update({ translation_count: 2 })
          .eq("language_id", qaa)
          .eq("translation_count", 0);
        assert(!coverError, coverError?.message ?? "");
        const covered = await time(perfUser, "write");
        results.push(`write, all covered ${covered} ms`);
        assert(covered < PERF_LIMIT_MS, `all covered: ${covered} ms`);
        console.log(`        (${results.join("; ")})`);
      });
    } else {
      console.log("skip    queue speed check (remote database; set VERIFY_PERF=1 to run it)");
    }
  } catch (err) {
    fail("setup", err);
  } finally {
    await deleteTestUsers(admin, createdUsers);
    await removeTestLanguage(admin).catch(() => {});
    await deleteSentencesBySource(admin, perfSource).catch((err) => fail("cleanup", err));
    await deleteSentencesBySource(admin, source).catch((err) => fail("cleanup", err));
    app?.stop();
  }

  finish();
}

main();
