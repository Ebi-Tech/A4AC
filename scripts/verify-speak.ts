import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Browser as Chrome, type BrowserContext } from "playwright-core";
import { deleteAccountAndFiles } from "../src/lib/account-deletion";
import { adminClient, assert, createTestUser, deleteTestUsers, env, fail, finish, run, type TestUser } from "./lib/harness";
import { Browser, ensureApp, type App } from "./lib/http";

const TEST_LANGUAGE = "qaa";
const CHROME_PATH = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PERF_SENTENCES = 30_000;
const PERF_LIMIT_MS = 20;
const TINY_AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]);

/**
 * Turns a number into letters (0 → "a") so generated text has no digits.
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
 * Uploads bytes to the recordings bucket as the given user.
 *
 * @param user        The signed-in test user.
 * @param objectPath  Path inside the bucket.
 * @param bytes       File contents.
 * @param contentType MIME type to send.
 * @returns The Supabase storage error, or null.
 */
async function upload(user: TestUser, objectPath: string, bytes: Uint8Array = TINY_AUDIO, contentType = "audio/webm") {
  const { error } = await user.client.storage
    .from("recordings")
    .upload(objectPath, new Blob([bytes as BlobPart], { type: contentType }), { contentType });
  return error;
}

/**
 * Inserts a recording row as the given user.
 *
 * @param user   The signed-in test user.
 * @param fields Columns to set (contributor_id and defaults are filled in).
 * @returns The Supabase error, or null.
 */
async function insertRecording(user: TestUser, fields: Record<string, unknown>) {
  const { error } = await user.client.from("recordings").insert({
    contributor_id: user.id,
    mode: "translate_and_speak",
    mime_type: "audio/webm;codecs=opus",
    duration_ms: 2000,
    ...fields,
  });
  return error;
}

/**
 * Uploads a file and inserts its recording row in one step.
 *
 * @param user   The signed-in test user.
 * @param fields Recording columns (storage_path is generated).
 * @returns The Supabase error from the insert, or null.
 */
async function record(user: TestUser, fields: Record<string, unknown>) {
  const objectPath = `${user.id}/${randomUUID()}.webm`;
  const uploadError = await upload(user, objectPath);
  if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);
  return insertRecording(user, { storage_path: objectPath, ...fields });
}

/**
 * Lists the file names in a user's folder (service role).
 *
 * @param admin  Service-role client.
 * @param userId Folder name.
 * @returns File names.
 */
async function folderFiles(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await admin.storage.from("recordings").list(userId, { limit: 1000 });
  return (data ?? []).map((f) => f.name);
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
  await admin.from("recordings").delete().eq("language_id", data.id);
  await admin.from("translations").delete().eq("language_id", data.id);
  await admin.from("languages").delete().eq("id", data.id);
}

/**
 * Deletes every sentence from a source in batches small enough for the API.
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
 * Inserts rows in batches through the service role.
 *
 * @param admin Service-role client.
 * @param table Table name.
 * @param rows  Rows to insert.
 * @param size  Batch size.
 */
async function insertInBatches(admin: SupabaseClient, table: string, rows: object[], size = 250): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

/**
 * Writes a 3-second mono WAV file with half a second of near-silence, two
 * seconds of a modulated tone (speech-like bursts) and silence again, for
 * Chrome's fake microphone.
 *
 * @param file Where to write it.
 */
async function writeFakeSpeech(file: string): Promise<void> {
  const rate = 48000;
  const samples = rate * 3;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const speaking = t > 0.5 && t < 2.5;
    const envelope = speaking ? 0.5 * (1 + Math.sin(2 * Math.PI * 3 * t)) : 0;
    const value = speaking ? 0.4 * envelope * Math.sin(2 * Math.PI * 220 * t) : 0.0005 * Math.sin(2 * Math.PI * 50 * t);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  await writeFile(file, buffer);
}

/**
 * Signs a Chrome context in as a test user through the real email-link route.
 *
 * @param context Browser context.
 * @param admin   Service-role client.
 * @param baseUrl App URL.
 * @param email   User's email.
 */
async function signInChrome(context: BrowserContext, admin: SupabaseClient, baseUrl: string, email: string): Promise<void> {
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/auth/confirm?token_hash=${data.properties?.hashed_token}&type=email`);
  await page.close();
}

/**
 * Checks the prompt-5 SPEAK task: storage rules, recording rules, the
 * read-aloud queue, deletion and cleanup of audio files, playback URLs, the
 * real recording flow in headless Chrome with a fake microphone, and queue
 * speed. Uses temporary users, a temporary test language ("qaa") and
 * temporary sentences.
 *
 * @returns A promise that resolves when all checks have run.
 */
async function main(): Promise<void> {
  const admin = adminClient();
  const createdUsers: string[] = [];
  const source = `verify-speak-${Date.now()}`;
  const perfSource = `verify-speak-perf-${Date.now()}`;
  const tmp = await mkdtemp(path.join(tmpdir(), "a4ac-speak-"));
  let app: App | null = null;
  let chrome: Chrome | null = null;

  /**
   * Creates an onboarded test user and remembers them for cleanup.
   *
   * @param label   Label for the email address.
   * @param options Anchor and spoken languages.
   * @returns The signed-in test user.
   */
  const user = async (label: string, options: { anchors?: string[]; speaks?: string[] } = { speaks: [TEST_LANGUAGE] }) => {
    const created = await createTestUser(admin, label, options);
    createdUsers.push(created.id);
    await admin.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", created.id);
    return created;
  };

  try {
    await removeTestLanguage(admin);
    const { data: lang, error: langError } = await admin
      .from("languages")
      .insert({ iso_code: TEST_LANGUAGE, name: "Verify speak language", is_anchor: false, status: "open" })
      .select("id")
      .single();
    assert(!langError && lang, `could not create test language: ${langError?.message}`);
    const qaa = lang.id;
    const { data: langs } = await admin.from("languages").select("id, iso_code").in("iso_code", ["eng", "ibo"]);
    const eng = langs!.find((l) => l.iso_code === "eng")!.id;
    const ibo = langs!.find((l) => l.iso_code === "ibo")!.id;

    const { data: sentences, error: sentError } = await admin
      .from("sentences")
      .insert(
        Array.from({ length: 70 }, (_, i) => ({
          anchor_language_id: eng,
          text: `Speak check sentence ${letters(i)} for testing`,
          source,
          source_license: "CC0-1.0",
        })),
      )
      .select("id, text")
      .order("text");
    assert(!sentError && sentences, `could not create test sentences: ${sentError?.message}`);

    const speaker = await user("speaker");
    const other = await user("other");
    const helper = await user("helper", { speaks: [TEST_LANGUAGE, "ibo"] });

    await run("a recording row cannot be created unless the file exists in the user's own folder", async () => {
      const missing = await insertRecording(speaker, {
        sentence_id: sentences[0].id,
        language_id: qaa,
        seen_anchor_language_id: eng,
        storage_path: `${speaker.id}/${randomUUID()}.webm`,
      });
      assert(missing?.hint === "no_file", `missing file gave ${missing?.hint ?? missing?.message ?? "no error"}`);

      const othersPath = `${other.id}/${randomUUID()}.webm`;
      assert(!(await upload(other, othersPath)), "setup upload failed");
      const foreign = await insertRecording(speaker, {
        sentence_id: sentences[0].id,
        language_id: qaa,
        seen_anchor_language_id: eng,
        storage_path: othersPath,
      });
      assert(foreign, "a row pointing at another user's file was accepted");
    });

    await run("a user cannot upload into another user's folder", async () => {
      const direct = await upload(speaker, `${other.id}/${randomUUID()}.webm`);
      assert(direct, "direct upload into another folder was accepted");
      const signed = await speaker.client.storage.from("recordings").createSignedUploadUrl(`${other.id}/${randomUUID()}.webm`);
      assert(signed.error, "signed upload URL for another folder was issued");
    });

    await run("the bucket refuses files over 1 MB and wrong types", async () => {
      const big = await upload(speaker, `${speaker.id}/${randomUUID()}.webm`, new Uint8Array(1_100_000));
      assert(big, "a 1.1 MB file was accepted");
      const wrongType = await upload(speaker, `${speaker.id}/${randomUUID()}.webm`, TINY_AUDIO, "audio/wav");
      assert(wrongType, "audio/wav was accepted");
      const text = await upload(speaker, `${speaker.id}/${randomUUID()}.webm`, TINY_AUDIO, "text/plain");
      assert(text, "text/plain was accepted");
      const wrongExtension = await upload(speaker, `${speaker.id}/${randomUUID()}.wav`, TINY_AUDIO, "audio/webm");
      assert(wrongExtension, "a .wav file name was accepted");
      const ok = await upload(speaker, `${speaker.id}/${randomUUID()}.m4a`, TINY_AUDIO, "audio/mp4");
      assert(!ok, `a valid audio/mp4 upload was refused: ${ok?.message}`);
    });

    await run("durations below the minimum and above the maximum are rejected", async () => {
      const short = await record(speaker, { sentence_id: sentences[1].id, language_id: qaa, seen_anchor_language_id: eng, duration_ms: 900 });
      assert(short?.hint === "duration", `900 ms gave ${short?.hint ?? "no error"}`);
      const long = await record(speaker, { sentence_id: sentences[1].id, language_id: qaa, seen_anchor_language_id: eng, duration_ms: 15_100 });
      assert(long?.hint === "duration", `15.1 s gave ${long?.hint ?? "no error"}`);
    });

    await run("a second recording for the same sentence, language and mode is rejected (other mode allowed)", async () => {
      const first = await record(speaker, { sentence_id: sentences[2].id, language_id: qaa, seen_anchor_language_id: eng });
      assert(!first, `first recording failed: ${first?.message}`);
      const second = await record(speaker, { sentence_id: sentences[2].id, language_id: qaa, seen_anchor_language_id: eng });
      assert(second?.hint === "duplicate", `second gave ${second?.hint ?? "no error"}`);
    });

    const tr = async (sentence: number, status: string, contributor: string, language = qaa) => {
      const { data, error } = await admin
        .from("translations")
        .insert({ sentence_id: sentences[sentence].id, language_id: language, seen_anchor_language_id: eng, contributor_id: contributor, text: `Readable text ${letters(sentence)} here`, status })
        .select("id")
        .single();
      if (error || !data) throw new Error(`translation setup failed: ${error?.message}`);
      return data.id as string;
    };
    const tVerified = await tr(10, "verified", helper.id);
    const tUnverified = await tr(11, "unverified", helper.id);
    const tRejected = await tr(12, "rejected", helper.id);
    const tPending = await tr(13, "pending", helper.id);
    const tOwn = await tr(14, "unverified", speaker.id);
    const tOtherLanguage = await tr(15, "verified", helper.id, ibo);

    await run("read-aloud rejects another sentence or language, rejected or pending, and the user's own translation", async () => {
      const readAloud = (sentence: number, translationId: string) =>
        record(speaker, { sentence_id: sentences[sentence].id, language_id: qaa, mode: "read_aloud", translation_id: translationId });

      assert(await readAloud(16, tVerified), "a translation of another sentence was accepted");
      assert(await readAloud(15, tOtherLanguage), "a translation in another language was accepted");
      const rejected = await readAloud(12, tRejected);
      assert(rejected?.hint === "bad_source", `rejected gave ${rejected?.hint ?? "no error"}`);
      const pending = await readAloud(13, tPending);
      assert(pending?.hint === "bad_source", `pending gave ${pending?.hint ?? "no error"}`);
      const own = await readAloud(14, tOwn);
      assert(own?.hint === "bad_source", `own gave ${own?.hint ?? "no error"}`);
      const ok = await readAloud(10, tVerified);
      assert(!ok, `a valid read-aloud was rejected: ${ok?.message}`);
      const otherMode = await record(speaker, { sentence_id: sentences[10].id, language_id: qaa, seen_anchor_language_id: eng });
      assert(!otherMode, `the same sentence in the other mode was rejected: ${otherMode?.message}`);
    });

    await run("the read-aloud queue never offers the user's own, pending or rejected translations, and prefers verified", async () => {
      const seen = new Set<string>();
      for (let i = 0; i < 15; i++) {
        const { data, error } = await other.client.rpc("next_translation_for_read_aloud", { p_language_id: qaa });
        if (error) throw new Error(error.message);
        if (data?.[0]) seen.add(data[0].translation_id);
      }
      assert(seen.size === 1 && seen.has(tVerified), `other user was offered ${[...seen].join(", ")} (expected only the verified one first)`);

      const offered = new Set<string>();
      for (let i = 0; i < 15; i++) {
        const { data } = await speaker.client.rpc("next_translation_for_read_aloud", { p_language_id: qaa });
        if (data?.[0]) offered.add(data[0].translation_id);
      }
      for (const forbidden of [tOwn, tRejected, tPending]) assert(!offered.has(forbidden), "a forbidden translation was offered");
      assert(offered.size === 1 && offered.has(tUnverified), `speaker was offered ${[...offered].join(", ")} (expected only the unverified one)`);
    });

    await run("the 61st recording in 10 minutes is blocked", async () => {
      const busy = await user("busy");
      for (let i = 0; i < 60; i++) {
        const error = await record(busy, { sentence_id: sentences[i].id, language_id: qaa, seen_anchor_language_id: eng });
        assert(!error, `recording ${i + 1} failed: ${error?.message}`);
      }
      const error = await record(busy, { sentence_id: sentences[60].id, language_id: qaa, seen_anchor_language_id: eng });
      assert(error?.hint === "rate_limit", `61st gave ${error?.hint ?? "no error"}`);
    });

    app = await ensureApp();

    await run("deleting a pending recording (through the app) removes its file; account deletion removes all files", async () => {
      const owner = await user("owner");
      const objectPath = `${owner.id}/${randomUUID()}.webm`;
      assert(!(await upload(owner, objectPath)), "upload failed");
      assert(!(await insertRecording(owner, { sentence_id: sentences[20].id, language_id: qaa, seen_anchor_language_id: eng, storage_path: objectPath })), "insert failed");
      const { data: row } = await admin.from("recordings").select("id").eq("storage_path", objectPath).single();

      const browser = new Browser(app!.baseUrl);
      await browser.signIn(admin, owner.email);
      const res = await browser.submitForm("/profile", "id", { id: row!.id }, "Yes, delete recording");
      assert(res.body.includes("Deleted."), `delete action did not confirm (status ${res.status})`);
      const { count } = await admin.from("recordings").select("*", { count: "exact", head: true }).eq("id", row!.id);
      assert(count === 0, "row still exists");
      assert(!(await folderFiles(admin, owner.id)).includes(objectPath.split("/")[1]), "file still exists after deleting the recording");

      const leaving = await user("leaving");
      for (let i = 0; i < 3; i++) await record(leaving, { sentence_id: sentences[21 + i].id, language_id: qaa, seen_anchor_language_id: eng });
      assert((await folderFiles(admin, leaving.id)).length === 3, "setup: expected 3 files");
      await deleteAccountAndFiles(admin, leaving.id);
      assert((await folderFiles(admin, leaving.id)).length === 0, "files left after account deletion");
    });

    await run("cleanup-orphans removes an old file with no row and keeps a file that has one", async () => {
      const tidy = await user("tidy");
      const orphan = `${tidy.id}/${randomUUID()}.webm`;
      assert(!(await upload(tidy, orphan)), "upload failed");
      const kept = await record(tidy, { sentence_id: sentences[30].id, language_id: qaa, seen_anchor_language_id: eng });
      assert(!kept, `recording failed: ${kept?.message}`);

      const runCleanup = (...args: string[]) => {
        const result = spawnSync("npx", ["tsx", "scripts/cleanup-orphans.ts", "--prefix", tidy.id, "--json", ...args], { encoding: "utf8" });
        if (result.status !== 0) throw new Error(`cleanup-orphans failed: ${result.stderr}`);
        return JSON.parse(result.stdout.trim().split("\n").pop()!);
      };

      const fresh = runCleanup();
      assert(fresh.orphans === 0, "a file younger than 1 hour was treated as an orphan");
      const dry = runCleanup("--older-than-minutes", "0", "--dry-run");
      assert(dry.orphans === 1 && dry.deleted === 0 && (await folderFiles(admin, tidy.id)).length === 2, "dry run deleted something");
      const real = runCleanup("--older-than-minutes", "0");
      assert(real.deleted === 1 && real.paths[0] === orphan, `deleted ${JSON.stringify(real.paths)}`);
      const remaining = await folderFiles(admin, tidy.id);
      assert(remaining.length === 1 && remaining[0] !== orphan.split("/")[1], "the file with a row was not kept");
    });

    await run("signed playback URLs work for the owner (through the app); other users cannot read the bucket", async () => {
      const { data: row } = await admin
        .from("recordings")
        .select("id, storage_path")
        .eq("contributor_id", speaker.id)
        .eq("mode", "translate_and_speak")
        .limit(1)
        .single();
      const browser = new Browser(app!.baseUrl);
      await browser.signIn(admin, speaker.email);
      const url = (await browser.callAction("/profile", "getPlaybackUrl", [row!.id])) as string | null;
      assert(url, "no signed URL returned to the owner");
      const audio = await fetch(url);
      const bytes = new Uint8Array(await audio.arrayBuffer());
      assert(audio.ok && bytes.length === TINY_AUDIO.length, `signed URL fetch: ${audio.status}, ${bytes.length} bytes`);

      const otherBrowser = new Browser(app!.baseUrl);
      await otherBrowser.signIn(admin, other.email);
      const notTheirs = await otherBrowser.callAction("/profile", "getPlaybackUrl", [row!.id]);
      assert(notTheirs === null, "another user got a playback URL through the app");
      const signed = await other.client.storage.from("recordings").createSignedUrl(row!.storage_path, 60);
      assert(signed.error || !signed.data?.signedUrl, "another user could sign the owner's file");
      const download = await other.client.storage.from("recordings").download(row!.storage_path);
      assert(download.error, "another user could download the owner's file");
      const { data: listed } = await other.client.storage.from("recordings").list(speaker.id);
      assert(!listed?.length, "another user could list the owner's folder");
    });

    if (existsSync(CHROME_PATH)) {
      const fakeAudio = path.join(tmp, "speech.wav");
      await writeFakeSpeech(fakeAudio);
      chrome = await chromium.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${fakeAudio}`],
      });

      await run("Chrome (fake microphone): record, check, submit; row saved with mime type and client checks; next sentence shown at once", async () => {
        const voice = await user("voice", { speaks: [TEST_LANGUAGE] });
        const context = await chrome!.newContext();
        await signInChrome(context, admin, app!.baseUrl, voice.email);
        const page = await context.newPage();
        await page.goto(`${app!.baseUrl}/contribute/${TEST_LANGUAGE}/speak`);
        const firstSentence = await page.locator("[data-sentence]").getAttribute("data-sentence");

        await page.getByRole("button", { name: "Start recording" }).click();
        await page.getByText(/Recording 0:0[1-9]/).waitFor({ timeout: 10_000 });
        await page.waitForTimeout(2500);
        await page.getByRole("button", { name: "Stop recording" }).click();
        await page.locator("audio").waitFor({ timeout: 10_000 });
        await page.getByRole("button", { name: /^Submit/ }).click();
        await page.waitForFunction((first) => document.querySelector("[data-sentence]")?.getAttribute("data-sentence") !== first, firstSentence, { timeout: 5000 });
        await page.locator('[data-upload-state="uploaded"]').waitFor({ timeout: 20_000 });

        const { data: rows } = await admin.from("recordings").select("mime_type, duration_ms, auto_check_result, storage_path, sentence_id").eq("contributor_id", voice.id);
        assert(rows?.length === 1, `expected 1 row, found ${rows?.length}`);
        const [saved] = rows;
        const checks = saved.auto_check_result as { source?: string; decoded?: boolean; speech_ms?: number };
        assert(saved.sentence_id === firstSentence, "row is for a different sentence");
        assert(saved.mime_type.startsWith("audio/webm"), `mime type ${saved.mime_type}`);
        assert(saved.duration_ms >= 2000 && saved.duration_ms <= 4500, `duration ${saved.duration_ms} ms`);
        assert(checks.source === "client" && checks.decoded === true && (checks.speech_ms ?? 0) >= 500, `checks ${JSON.stringify(checks)}`);
        assert((await folderFiles(admin, voice.id)).length === 1, "file not in the user's folder");
        await context.close();
      });

      await run("Chrome: read-aloud mode records against the translation; offline uploads wait, warn on leaving, then retry", async () => {
        const reader = await user("reader", { speaks: [TEST_LANGUAGE] });
        const context = await chrome!.newContext();
        await signInChrome(context, admin, app!.baseUrl, reader.email);
        const page = await context.newPage();
        await page.goto(`${app!.baseUrl}/contribute/${TEST_LANGUAGE}/speak`);
        await page.getByRole("tab", { name: "Read aloud" }).click();
        await page.getByText(/^Read this aloud in/).waitFor();

        await page.getByRole("button", { name: "Start recording" }).click();
        await page.waitForTimeout(2200);
        await page.getByRole("button", { name: "Stop recording" }).click();
        await page.locator("audio").waitFor();
        await context.setOffline(true);
        await page.getByRole("button", { name: /^Submit/ }).click();
        await page.locator('[data-upload-state="pending"]').waitFor({ timeout: 5000 });
        const pendingText = await page.locator('[data-upload-state="pending"]').innerText();
        assert(/1 recording waiting to upload/.test(pendingText), `indicator said "${pendingText}"`);

        let warned = false;
        page.once("dialog", async (dialog) => {
          warned = dialog.type() === "beforeunload";
          await dialog.dismiss();
        });
        await page.close({ runBeforeUnload: true }).catch(() => {});
        await page.waitForTimeout(500);
        assert(warned, "no warning when leaving with an unsent recording");

        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event("online"))).catch(() => {});
        const deadline = Date.now() + 30_000;
        let rows: { mode: string; translation_id: string | null; seen_anchor_language_id: string | null }[] = [];
        while (Date.now() < deadline) {
          const { data } = await admin.from("recordings").select("mode, translation_id, seen_anchor_language_id").eq("contributor_id", reader.id);
          rows = data ?? [];
          if (rows.length) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        assert(rows.length === 1, "the clip was not uploaded after coming back online");
        assert(rows[0].mode === "read_aloud" && rows[0].translation_id && !rows[0].seen_anchor_language_id, `row ${JSON.stringify(rows[0])}`);
        await context.close();
      });

      await run("Chrome: a blocked microphone shows the permission help", async () => {
        const blocked = await chromium.launch({ executablePath: CHROME_PATH, headless: true, args: ["--deny-permission-prompts"] });
        try {
          const person = await user("nomic", { speaks: [TEST_LANGUAGE] });
          const context = await blocked.newContext();
          await signInChrome(context, admin, app!.baseUrl, person.email);
          const page = await context.newPage();
          await page.goto(`${app!.baseUrl}/contribute/${TEST_LANGUAGE}/speak`);
          await page.getByRole("button", { name: "Start recording" }).click();
          const alert = page.getByRole("alert").filter({ hasText: /Microphone access is blocked|could not find a microphone/ });
          await alert.waitFor({ timeout: 10_000 });
          assert((await alert.innerText()).includes("Reload the page") || (await alert.innerText()).includes("microphone"), "no instructions shown");
        } finally {
          await blocked.close();
        }
      });
    } else {
      console.log(`skip    Chrome recording checks (Chrome not found at ${CHROME_PATH}; set CHROME_PATH)`);
    }

    const local = /127\.0\.0\.1|localhost/.test(env("NEXT_PUBLIC_SUPABASE_URL"));
    if (local || process.env.VERIFY_PERF === "1") {
      await run(`read-aloud queue under ${PERF_LIMIT_MS} ms with ${PERF_SENTENCES.toLocaleString()} sentences and translations`, async () => {
        const perfUser = await user("perf");
        const perfWriter = await user("perfwriter");
        await insertInBatches(
          admin,
          "sentences",
          Array.from({ length: PERF_SENTENCES }, (_, i) => ({
            anchor_language_id: eng,
            text: `Perf read sentence ${letters(i)} about the market`,
            source: perfSource,
            source_license: "test",
          })),
        );
        const perfIds: string[] = [];
        for (let from = 0; ; from += 1000) {
          const { data } = await admin.from("sentences").select("id").eq("source", perfSource).range(from, from + 999);
          perfIds.push(...(data ?? []).map((s) => s.id));
          if (!data || data.length < 1000) break;
        }
        await insertInBatches(
          admin,
          "translations",
          perfIds.map((id, i) => ({
            sentence_id: id,
            language_id: qaa,
            seen_anchor_language_id: eng,
            contributor_id: i % 10 === 0 ? perfUser.id : perfWriter.id,
            text: `Perf text ${letters(i)}`,
            status: i % 3 === 0 ? "verified" : i % 3 === 1 ? "unverified" : "rejected",
          })),
          500,
        );
        const { data: offered } = await perfUser.client.rpc("next_translation_for_read_aloud", { p_language_id: qaa });
        assert(offered?.[0]?.translation_id, "the queue returned nothing to time");
        const { data: offeredRow } = await admin.from("translations").select("status, contributor_id").eq("id", offered[0].translation_id).single();
        assert(offeredRow?.status === "verified" && offeredRow.contributor_id !== perfUser.id, `offered ${JSON.stringify(offeredRow)}`);
        const { data, error } = await admin.rpc("benchmark_next_sentence", { p_user: perfUser.id, p_language_id: qaa, p_task: "read", p_runs: 20 });
        if (error) throw new Error(error.message);
        const ms = Number(data);
        console.log(`        (read-aloud ${ms} ms)`);
        assert(ms < PERF_LIMIT_MS, `${ms} ms`);
      });
    } else {
      console.log("skip    read-aloud queue speed check (remote database; set VERIFY_PERF=1 to run it)");
    }
  } catch (err) {
    fail("setup", err);
  } finally {
    await chrome?.close().catch(() => {});
    for (const id of createdUsers) await deleteAccountAndFiles(admin, id).catch(() => {});
    await deleteTestUsers(admin, createdUsers);
    await removeTestLanguage(admin).catch(() => {});
    await deleteSentencesBySource(admin, perfSource).catch((err) => fail("cleanup", err));
    await deleteSentencesBySource(admin, source).catch((err) => fail("cleanup", err));
    await rm(tmp, { recursive: true, force: true });
    app?.stop();
  }

  finish();
}

main();
