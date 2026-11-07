import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

let failures = 0;

/**
 * Reads a required environment variable or exits with a helpful message.
 *
 * @param name The variable name.
 * @returns Its value.
 */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env.local and fill it in (see README).`);
    process.exit(1);
  }
  return value;
}

/**
 * Creates a Supabase client authenticated with the service role key.
 *
 * @returns A service-role client without session persistence.
 */
export function adminClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Runs one named check and prints "ok" or "FAILED" with the reason.
 *
 * @param name  Human-readable check name.
 * @param check Async function that throws when the check fails.
 * @returns A promise that resolves once the line is printed.
 */
export async function run(name: string, check: () => Promise<void>): Promise<void> {
  try {
    await check();
    console.log(`ok      ${name}`);
  } catch (err) {
    fail(name, err);
  }
}

/**
 * Records a failure that happened outside run() (for example during setup).
 *
 * @param name What was being done.
 * @param err  The error thrown.
 */
export function fail(name: string, err: unknown): void {
  failures += 1;
  console.log(`FAILED  ${name}: ${err instanceof Error ? err.message : String(err)}`);
}

/**
 * Throws with the given message when the condition is false.
 *
 * @param condition Value that must be truthy.
 * @param message   Error message if it is not.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Prints "all checks passed" or the number of failures, and sets the exit code.
 */
export function finish(): void {
  if (failures === 0) {
    console.log("all checks passed");
  } else {
    console.log(`${failures} check(s) FAILED`);
    process.exitCode = 1;
  }
}

export type TestUser = { id: string; email: string; client: SupabaseClient };

/**
 * Creates a confirmed throwaway user and returns a client signed in as them,
 * so RLS and triggers apply exactly as for a real contributor. With
 * consent = true the user accepts the current consent version through the
 * same accept_consent() function the app uses. The user is also given the
 * listed anchor languages ("understands").
 *
 * @param admin   Service-role client.
 * @param label   Short label used in the email address.
 * @param options consent (default true); anchors: ISO codes the user reads
 *                (default ["eng"]); speaks: ISO codes the user speaks natively.
 * @returns The user's id, email and a signed-in anon-key client.
 */
export async function createTestUser(
  admin: SupabaseClient,
  label: string,
  options: { consent?: boolean; anchors?: string[]; speaks?: string[] } = {},
): Promise<TestUser> {
  const email = `verify-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);

  const client = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`sign-in failed: ${signIn.error.message}`);

  if (options.consent ?? true) {
    const { data: settings } = await admin.from("app_settings").select("current_consent_version").single();
    const accept = await client.rpc("accept_consent", {
      p_version: settings?.current_consent_version,
      p_is_adult: true,
    });
    if (accept.error) throw new Error(`accept_consent failed: ${accept.error.message}`);
  }

  const anchors = options.anchors ?? ["eng"];
  const speaks = options.speaks ?? [];
  if (anchors.length || speaks.length) {
    const { data: langs } = await admin.from("languages").select("id, iso_code").in("iso_code", [...anchors, ...speaks]);
    const rows = (langs ?? []).map((l) => ({
      user_id: data.user.id,
      language_id: l.id,
      ability: speaks.includes(l.iso_code) ? "native" : "understands",
    }));
    const insert = await client.from("user_languages").insert(rows);
    if (insert.error) throw new Error(`could not add languages: ${insert.error.message}`);
  }

  return { id: data.user.id, email, client };
}

/**
 * Deletes the given test users (and, by cascade, everything they created).
 *
 * @param admin Service-role client.
 * @param ids   User ids to delete; unknown ids are ignored.
 */
export async function deleteTestUsers(admin: SupabaseClient, ids: string[]): Promise<void> {
  for (const id of ids) await admin.auth.admin.deleteUser(id);
}

/**
 * Looks up the first seed sentence and a language by ISO code.
 *
 * @param admin   Service-role client.
 * @param isoCode Language code, e.g. "ibo".
 * @returns The sentence id, the language id and the English (anchor) language id.
 */
export async function seedIds(
  admin: SupabaseClient,
  isoCode: string,
): Promise<{ sentenceId: string; languageId: string; engId: string }> {
  const { data: sentence } = await admin.from("sentences").select("id").eq("source", "project-seed").limit(1).single();
  const { data: language } = await admin.from("languages").select("id").eq("iso_code", isoCode).single();
  const { data: eng } = await admin.from("languages").select("id").eq("iso_code", "eng").single();
  if (!sentence || !language || !eng) throw new Error("seed data missing; run supabase db reset");
  return { sentenceId: sentence.id, languageId: language.id, engId: eng.id };
}
