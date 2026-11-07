import { parseArgs } from "node:util";
import { listFilesRecursively, removeRecordingFiles } from "../src/lib/recordings";
import { adminClient } from "./lib/harness";

const USAGE = `Usage: npm run cleanup-orphans -- [--dry-run] [--older-than-minutes 60] [--prefix <user id>] [--json]

Deletes audio files in the "recordings" bucket that are older than the given
age (default 60 minutes) and have no matching recordings row.`;

/**
 * Finds which of the given storage paths have a recordings row.
 *
 * @param admin Service-role client.
 * @param paths Object paths to look up.
 * @returns The set of paths that are referenced by a row.
 */
async function referencedPaths(admin: ReturnType<typeof adminClient>, paths: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < paths.length; i += 50) {
    const { data, error } = await admin.from("recordings").select("storage_path").in("storage_path", paths.slice(i, i + 50));
    if (error) throw new Error(`Could not read recordings: ${error.message}`);
    for (const row of data ?? []) found.add(row.storage_path as string);
  }
  return found;
}

/**
 * Entry point: lists the bucket (or one folder), picks files older than the
 * cut-off with no recordings row, and deletes them unless --dry-run is set.
 *
 * @returns A promise that resolves when done; sets a non-zero exit code on error.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean" },
      "older-than-minutes": { type: "string" },
      prefix: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const minutes = Number(values["older-than-minutes"] ?? 60);
  if (!Number.isFinite(minutes) || minutes < 0) {
    console.error("--older-than-minutes must be a number of minutes (0 or more).");
    process.exitCode = 2;
    return;
  }

  const admin = adminClient();
  const cutoff = Date.now() - minutes * 60_000;
  const files = await listFilesRecursively(admin, (values.prefix ?? "").replace(/\/+$/, ""));
  const old = files.filter((file) => file.createdAt && Date.parse(file.createdAt) < cutoff);
  const referenced = await referencedPaths(admin, old.map((file) => file.path));
  const orphans = old.filter((file) => !referenced.has(file.path)).map((file) => file.path);

  if (!values["dry-run"]) await removeRecordingFiles(admin, orphans);

  const summary = { scanned: files.length, olderThanCutoff: old.length, orphans: orphans.length, deleted: values["dry-run"] ? 0 : orphans.length, dryRun: Boolean(values["dry-run"]), paths: orphans };
  if (values.json) {
    console.log(JSON.stringify(summary));
    return;
  }
  console.log(`Scanned ${summary.scanned} files; ${summary.olderThanCutoff} older than ${minutes} min; ${summary.orphans} without a recording row.`);
  console.log(summary.dryRun ? "Dry run: nothing deleted." : `Deleted ${summary.deleted} file(s).`);
  for (const path of orphans.slice(0, 20)) console.log(`  ${path}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
