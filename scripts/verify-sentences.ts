import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeNextParam, encodeNextParam, safeNextPath } from "../src/lib/routes";
import { adminClient, assert, createTestUser, deleteTestUsers, fail, finish, run, type TestUser } from "./lib/harness";
import { Browser, ensureApp, type App } from "./lib/http";

const TEST_LANGUAGE = "qaa";
const ADMIN_PATHS = ["/admin", "/admin/sentences", "/admin/anchors", "/admin/language-requests"];

const IMPORT_FILE = [
  "The children walk to school together.",
  "How much are these tomatoes",
  "The children walk to school together!",
  "Hello there",
  "This sentence is far too long because it keeps going on and on without any end in sight",
  "We bought 3 bags of rice.",
  "Read more at www.example.com today please.",
  "Write to me at someone@example.com soon.",
  "The NGO opened a new clinic.",
  "That was a zorblax thing to say.",
  "“My mother sells fresh bread,” she said.",
].join("\n");

/**
 * Runs the import script as a child process, like a person would.
 *
 * @param args Arguments after the script name.
 * @returns Exit status, stdout and stderr.
 */
function runImport(args: string[]) {
  const result = spawnSync("npx", ["tsx", "scripts/import-sentences.ts", ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Calls a queue function as the given user.
 *
 * @param user     The signed-in test user.
 * @param task     "write" or "speak".
 * @param language Target language id.
 * @returns The returned row, or null when nothing is available.
 */
async function nextSentence(user: TestUser, task: "write" | "speak", language: string) {
  const { data, error } = await user.client.rpc(`next_sentence_for_${task}`, { p_language_id: language });
  if (error) throw new Error(`next_sentence_for_${task}: ${error.message}`);
  return (data?.[0] ?? null) as { sentence_id: string; anchor_text: string; anchor_iso_code: string } | null;
}

/**
 * Calls a queue function several times and collects the sentence ids returned.
 *
 * @param user     The signed-in test user.
 * @param task     "write" or "speak".
 * @param language Target language id.
 * @param times    Number of calls.
 * @returns The ids returned (null entries when nothing was available).
 */
async function sample(user: TestUser, task: "write" | "speak", language: string, times: number) {
  const ids: (string | null)[] = [];
  for (let i = 0; i < times; i++) ids.push((await nextSentence(user, task, language))?.sentence_id ?? null);
  return ids;
}

/**
 * Removes a leftover test language from an earlier interrupted run.
 *
 * @param admin Service-role client.
 */
async function removeTestLanguage(admin: SupabaseClient): Promise<void> {
  const { data } = await admin.from("languages").select("id").eq("iso_code", TEST_LANGUAGE).maybeSingle();
  if (!data) return;
  await admin.from("translations").delete().eq("language_id", data.id);
  await admin.from("recordings").delete().eq("language_id", data.id);
  await admin.from("languages").delete().eq("id", data.id);
}

/**
 * Checks prompt-3 behaviour: sentence import rules, admin protection, the
 * task queue, deleting an account during onboarding and safe "next"
 * redirects. Uses temporary users, a temporary test language ("qaa") and a
 * dev server it starts if none is running.
 *
 * @returns A promise that resolves when all checks have run.
 */
async function main(): Promise<void> {
  const admin = adminClient();
  const createdUsers: string[] = [];
  const importSource = `verify-import-${Date.now()}`;
  let app: App | null = null;
  const tmp = await mkdtemp(path.join(tmpdir(), "a4ac-verify-"));

  /**
   * Creates a test user and remembers it for cleanup.
   *
   * @param label   Label for the email address.
   * @param options Consent, anchor and spoken languages.
   * @returns The signed-in test user.
   */
  const user = async (label: string, options: { consent?: boolean; anchors?: string[]; speaks?: string[] } = {}) => {
    const created = await createTestUser(admin, label, options);
    createdUsers.push(created.id);
    return created;
  };

  try {
    await run("safeNextPath rejects external URLs and keeps internal paths", async () => {
      const bad = [
        "https://evil.example",
        "//evil.example",
        "/\\evil.example",
        "\\\\evil.example",
        "javascript:alert(1)",
        "/\t/evil.example",
        "http:/evil.example",
        "",
      ];
      for (const value of bad) assert(safeNextPath(value) === "/", `accepted ${JSON.stringify(value)}`);
      assert(safeNextPath("/admin/sentences?page=2&q=a") === "/admin/sentences?page=2&q=a", "lost an internal path");
      assert(decodeNextParam(encodeNextParam("/profile?x=1&y=2")) === "/profile?x=1&y=2", "encode/decode round trip failed");
      assert(decodeNextParam(encodeNextParam("https://evil.example")) === "/", "encoded external URL accepted");
    });

    await run("import refuses to run without a licence", async () => {
      const file = path.join(tmp, "nolicence.txt");
      await writeFile(file, "The children walk to school together.\n");
      const result = runImport([file, "--source", importSource]);
      assert(result.status !== 0, "script exited successfully");
      assert(/licen[cs]e/i.test(result.stderr), `unexpected message: ${result.stderr}`);
      const { count } = await admin.from("sentences").select("*", { count: "exact", head: true }).eq("source", importSource);
      assert(count === 0, `${count} sentence(s) were imported`);
    });

    await run("import skips duplicates, too short, too long, digits, URLs, emails, abbreviations and blocklisted lines", async () => {
      const file = path.join(tmp, "sentences.txt");
      const blocklist = path.join(tmp, "blocklist.txt");
      await writeFile(file, IMPORT_FILE);
      await writeFile(blocklist, "# test blocklist\nzorblax\n");

      const result = runImport([file, "--source", importSource, "--license", "CC0-1.0", "--blocklist", blocklist, "--json"]);
      assert(result.status === 0, `script failed: ${result.stderr}`);
      const summary = JSON.parse(result.stdout.trim().split("\n").pop()!);

      const expected = {
        already_in_database: 1,
        duplicate_in_file: 1,
        too_short: 1,
        too_long: 1,
        digits: 1,
        url: 1,
        email: 1,
        abbreviation: 1,
        blocklisted: 1,
      };
      assert(summary.imported === 2, `imported ${summary.imported}, expected 2`);
      for (const [reason, count] of Object.entries(expected)) {
        assert(summary.skipped[reason] === count, `${reason}: ${summary.skipped[reason]} (expected ${count})`);
      }

      const { data: rows } = await admin.from("sentences").select("text, difficulty, source_license").eq("source", importSource);
      const texts = (rows ?? []).map((r) => r.text).sort();
      assert(texts.includes('"My mother sells fresh bread," she said.'), `quotes not normalised: ${texts.join(" | ")}`);
      assert((rows ?? []).every((r) => r.difficulty >= 1 && r.difficulty <= 5 && r.source_license === "CC0-1.0"), "difficulty or licence missing");
    });
    await admin.from("sentences").delete().eq("source", importSource);

    app = await ensureApp();
    const nonAdmin = await user("plain");
    const adminUser = await user("admin");
    await admin.from("profiles").update({ role: "admin", onboarded_at: new Date().toISOString() }).eq("id", adminUser.id);
    await admin.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", nonAdmin.id);

    await run("a non-admin cannot call admin-only functions or change sentences", async () => {
      const { data: request } = await nonAdmin.client
        .from("language_requests")
        .insert({ requester_id: nonAdmin.id, name: "Verify Language" })
        .select("id")
        .single();
      const calls = [
        nonAdmin.client.rpc("approve_language_request", { p_request_id: request?.id, p_iso_code: "qab", p_name: "X" }),
        nonAdmin.client.rpc("decline_language_request", { p_request_id: request?.id }),
        nonAdmin.client.rpc("admin_anchor_list", {}),
        nonAdmin.client.rpc("admin_sentence_usage", { p_ids: [] }),
        nonAdmin.client.rpc("find_existing_sentences", { p_texts: ["Hello there friend"] }),
      ];
      for (const [i, call] of (await Promise.all(calls)).entries()) {
        assert(call.error && /admins only/i.test(call.error.message), `admin function #${i + 1} was allowed`);
      }

      const { data: eng } = await admin.from("languages").select("id").eq("iso_code", "eng").single();
      const insert = await nonAdmin.client
        .from("sentences")
        .insert({ anchor_language_id: eng!.id, text: "Sneaky new sentence here.", source: "x", source_license: "x" });
      assert(insert.error, "non-admin inserted a sentence");

      const { data: target } = await admin.from("sentences").select("id").eq("source", "project-seed").limit(1).single();
      await nonAdmin.client.from("sentences").update({ is_active: false }).eq("id", target!.id);
      const { data: after } = await admin.from("sentences").select("is_active").eq("id", target!.id).single();
      assert(after?.is_active === true, "non-admin deactivated a sentence");
    });

    await run("a non-admin cannot reach /admin pages (404), an admin can", async () => {
      const visitor = new Browser(app!.baseUrl);
      const plain = new Browser(app!.baseUrl);
      const boss = new Browser(app!.baseUrl);
      await plain.signIn(admin, nonAdmin.email);
      await boss.signIn(admin, adminUser.email);
      for (const p of ADMIN_PATHS) {
        const v = await visitor.get(p);
        assert(v.status === 404, `signed-out ${p}: ${v.status}`);
        const n = await plain.get(p);
        assert(n.status === 404, `non-admin ${p}: ${n.status}`);
        assert(!n.body.includes("Language requests"), `non-admin ${p} leaked admin content`);
        const a = await boss.get(p);
        assert(a.status === 200, `admin ${p}: ${a.status} ${a.location ?? ""}`);
      }
    });

    await run("the email-link 'next' redirect rejects external URLs", async () => {
      const cases: [string, string][] = [
        ["&next=https://evil.example/x", "/"],
        ["&next=//evil.example", "/"],
        [`&to=${encodeNextParam("https://evil.example")}`, "/"],
        [`&redirect_to=${encodeURIComponent(`https://evil.example/auth/confirm?to=${encodeNextParam("//evil.example")}`)}`, "/"],
        [`&redirect_to=${encodeURIComponent(`${app!.baseUrl}/auth/confirm?to=${encodeNextParam("/profile?tab=1")}`)}`, "/profile?tab=1"],
        ["&next=/languages", "/languages"],
      ];
      for (const [extra, expected] of cases) {
        const browser = new Browser(app!.baseUrl);
        const res = await browser.signIn(admin, nonAdmin.email, extra);
        assert(res.status === 307 && res.location, `no redirect for ${extra} (${res.status})`);
        const target = new URL(res.location, app!.baseUrl);
        assert(target.origin === new URL(app!.baseUrl).origin, `redirected off-site to ${res.location}`);
        assert(`${target.pathname}${target.search}` === expected, `${extra} went to ${target.pathname}${target.search}`);
      }
    });

    await run("an unonboarded user can delete their account from the onboarding screen", async () => {
      const newcomer = await user("newcomer", { consent: false, anchors: [] });
      const browser = new Browser(app!.baseUrl);
      await browser.signIn(admin, newcomer.email);

      const home = await browser.get("/profile");
      assert(home.status === 307 && home.location?.includes("/onboarding"), `not sent to onboarding (${home.status})`);
      const page = await browser.get("/onboarding");
      assert(page.body.includes("Delete my account"), "onboarding has no delete option");

      const res = await browser.submitForm("/onboarding", "confirm", { confirm: "DELETE" });
      assert(res.status === 303 && res.location?.includes("account=deleted"), `unexpected response ${res.status} ${res.location}`);
      const { data } = await admin.auth.admin.getUserById(newcomer.id);
      assert(!data?.user, "user still exists");
      const { count } = await admin.from("profiles").select("*", { count: "exact", head: true }).eq("id", newcomer.id);
      assert(count === 0, "profile still exists");
    });

    await removeTestLanguage(admin);
    const { data: lang, error: langError } = await admin
      .from("languages")
      .insert({ iso_code: TEST_LANGUAGE, name: "Verify test language", is_anchor: false, status: "open" })
      .select("id")
      .single();
    assert(!langError && lang, `could not create test language: ${langError?.message}`);
    const qaa = lang.id;
    const { data: langs } = await admin.from("languages").select("id, iso_code").in("iso_code", ["eng", "fra"]);
    const eng = langs!.find((l) => l.iso_code === "eng")!.id;
    const fra = langs!.find((l) => l.iso_code === "fra")!.id;
    const { data: active } = await admin.from("sentences").select("id, text").eq("is_active", true).order("created_at");
    assert(active && active.length >= 5, "need at least 5 active sentences");
    const [s1, s2, s3, s4] = active;

    const helper = await user("helper");
    const helper2 = await user("helper2");
    const reader = await user("reader", { speaks: [TEST_LANGUAGE] });
    const frenchOnly = await user("french", { anchors: ["fra"], speaks: [TEST_LANGUAGE] });

    const others = active.filter((s) => s.id !== s1.id);
    const coverWrite = await admin.from("translations").insert(
      others.map((s) => ({ sentence_id: s.id, language_id: qaa, seen_anchor_language_id: eng, contributor_id: helper.id, text: `qaa ${s.id}` })),
    );
    assert(!coverWrite.error, `setup translations failed: ${coverWrite.error?.message}`);
    const coverSpeak = await admin.from("recordings").insert(
      others.map((s, i) => ({
        sentence_id: s.id,
        language_id: qaa,
        seen_anchor_language_id: eng,
        contributor_id: helper.id,
        mode: "translate_and_speak",
        mime_type: "audio/webm",
        storage_path: `${helper.id}/verify-${i}.webm`,
      })),
    );
    assert(!coverSpeak.error, `setup recordings failed: ${coverSpeak.error?.message}`);

    await run("an English reader gets the English text", async () => {
      const row = await nextSentence(reader, "write", qaa);
      assert(row, "nothing returned");
      assert(row.anchor_iso_code === "eng", `anchor is ${row.anchor_iso_code}`);
      const expected = active.find((s) => s.id === row.sentence_id)?.text;
      assert(row.anchor_text === expected, `text "${row.anchor_text}" is not the English sentence`);
    });

    await run("the queue returns the least-covered sentence first (write and speak)", async () => {
      for (const task of ["write", "speak"] as const) {
        const ids = await sample(reader, task, qaa, 5);
        assert(ids.every((id) => id === s1.id), `${task} returned ${ids.join(", ")} instead of always the uncovered sentence`);
      }
    });

    await run("deactivating a sentence removes it from both queue functions", async () => {
      await admin.from("sentences").update({ is_active: false }).eq("id", s1.id);
      try {
        for (const task of ["write", "speak"] as const) {
          const ids = await sample(reader, task, qaa, 10);
          assert(ids.every((id) => id !== null), `${task} returned nothing`);
          assert(!ids.includes(s1.id), `${task} still returned the inactive sentence`);
        }
      } finally {
        await admin.from("sentences").update({ is_active: true }).eq("id", s1.id);
      }
    });

    await run("the queue never returns a sentence the user already did", async () => {
      const mine = await reader.client.from("translations").insert({
        sentence_id: s1.id,
        language_id: qaa,
        seen_anchor_language_id: eng,
        contributor_id: reader.id,
        text: "qaa by reader",
      });
      assert(!mine.error, `reader translation failed: ${mine.error?.message}`);
      const extra = await admin.from("translations").insert({
        sentence_id: s2.id,
        language_id: qaa,
        seen_anchor_language_id: eng,
        contributor_id: helper2.id,
        text: "qaa second",
      });
      assert(!extra.error, `helper2 translation failed: ${extra.error?.message}`);

      const ids = await sample(reader, "write", qaa, 15);
      assert(ids.every((id) => id !== null), "queue returned nothing");
      assert(!ids.includes(s1.id), "returned a sentence the user already translated");
      assert(!ids.includes(s2.id), "returned a more-covered sentence while less-covered ones exist");
    });

    await run("a French-only user only gets sentences with a verified French version, in French", async () => {
      const before = await nextSentence(frenchOnly, "write", qaa);
      assert(before === null, "got a sentence although no verified French exists");

      const french = await admin.from("translations").insert([
        { sentence_id: s3.id, language_id: fra, seen_anchor_language_id: eng, contributor_id: helper.id, text: "Version française vérifiée.", status: "verified" },
        { sentence_id: s4.id, language_id: fra, seen_anchor_language_id: eng, contributor_id: helper.id, text: "Version non vérifiée.", status: "pending" },
      ]);
      assert(!french.error, `French setup failed: ${french.error?.message}`);

      for (let i = 0; i < 8; i++) {
        const row = await nextSentence(frenchOnly, "write", qaa);
        assert(row, "French reader got nothing");
        assert(row.sentence_id === s3.id, `got ${row.sentence_id}, which has no verified French`);
        assert(row.anchor_iso_code === "fra" && row.anchor_text === "Version française vérifiée.", `shown "${row.anchor_text}" (${row.anchor_iso_code})`);
      }
    });
  } catch (err) {
    fail("setup", err);
  } finally {
    await deleteTestUsers(admin, createdUsers);
    await removeTestLanguage(admin).catch(() => {});
    await admin.from("sentences").delete().eq("source", importSource);
    await rm(tmp, { recursive: true, force: true });
    app?.stop();
  }

  finish();
}

main();
