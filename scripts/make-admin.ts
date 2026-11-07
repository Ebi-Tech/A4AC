import { adminClient } from "./lib/harness";

/**
 * Finds an auth user by email, paging through the admin user list.
 *
 * @param email Email address (case-insensitive).
 * @returns The user's id, or null if no user has that email.
 */
async function findUserId(email: string): Promise<string | null> {
  const admin = adminClient();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 1000) return null;
  }
}

/**
 * Entry point: promotes the user with the given email to admin.
 * Usage: npm run make-admin -- <email>
 *
 * @returns A promise that resolves when done; sets a non-zero exit code on error.
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run make-admin -- <email>");
    process.exitCode = 2;
    return;
  }

  const userId = await findUserId(email);
  if (!userId) {
    console.error(`No user with email ${email}. They need to sign in once first.`);
    process.exitCode = 1;
    return;
  }

  const { error } = await adminClient().from("profiles").update({ role: "admin" }).eq("id", userId);
  if (error) throw new Error(error.message);
  console.log(`${email} is now an admin.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
