import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { importSentences, parseBlocklist, SKIP_REASON_TEXT, type ImportSummary, type SkipReason } from "../src/lib/sentence-import";
import { adminClient } from "./lib/harness";

const USAGE = `Usage: npm run import-sentences -- <file> --source "<name>" --license "<licence>" [options]

  <file>              .txt (one sentence per line) or .csv / .tsv (text, topic, difficulty)
  --source <name>     where the sentences come from (required)
  --license <id>      licence of the source, e.g. CC0-1.0 (required)
  --blocklist <file>  blocklist file (default: config/blocklist.txt)
  --dry-run           check the file and print the summary without importing
  --json              print the summary as JSON`;

/**
 * Prints a human-readable import summary.
 *
 * @param summary The result of importSentences().
 */
function printSummary(summary: ImportSummary): void {
  console.log(`${summary.dryRun ? "Would import" : "Imported"}: ${summary.imported} of ${summary.total} lines`);
  const reasons = Object.entries(summary.skipped) as [SkipReason, number][];
  if (reasons.length === 0) {
    console.log("Skipped: none");
    return;
  }
  console.log("Skipped:");
  for (const [reason, count] of reasons) console.log(`  ${String(count).padStart(5)}  ${SKIP_REASON_TEXT[reason]}`);
  console.log("First skipped lines:");
  for (const row of summary.examples) console.log(`  line ${row.line} (${SKIP_REASON_TEXT[row.reason]}): ${row.text}`);
}

/**
 * Entry point: reads the arguments, refuses to run without a licence, then
 * validates and imports the file with the service role key.
 *
 * @returns A promise that resolves when the import finishes; sets a non-zero exit code on error.
 */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      source: { type: "string" },
      license: { type: "string" },
      licence: { type: "string" },
      blocklist: { type: "string" },
      "dry-run": { type: "boolean" },
      json: { type: "boolean" },
    },
  });

  const file = positionals[0];
  const license = (values.license ?? values.licence ?? "").trim();
  const source = (values.source ?? "").trim();

  if (!file) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!license) {
    console.error('Refusing to import: --license is required (for example --license "CC0-1.0").');
    process.exitCode = 2;
    return;
  }
  if (!source) {
    console.error('Refusing to import: --source is required (for example --source "Tatoeba export 2026-11").');
    process.exitCode = 2;
    return;
  }

  const content = await readFile(file, "utf8");
  const blocklistFile = values.blocklist ?? path.join("config", "blocklist.txt");
  const blocklist = parseBlocklist(await readFile(blocklistFile, "utf8").catch(() => ""));

  const summary = await importSentences(adminClient(), content, {
    fileName: path.basename(file),
    source,
    license,
    blocklist,
    dryRun: values["dry-run"],
  });

  if (values.json) {
    console.log(JSON.stringify(summary));
  } else {
    printSummary(summary);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
