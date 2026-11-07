import type { SupabaseClient } from "@supabase/supabase-js";

export const MIN_WORDS = 3;
export const MAX_WORDS = 15;

export type SkipReason =
  | "empty"
  | "duplicate_in_file"
  | "already_in_database"
  | "too_short"
  | "too_long"
  | "digits"
  | "url"
  | "email"
  | "abbreviation"
  | "blocklisted";

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  empty: "empty line",
  duplicate_in_file: "duplicate within the file",
  already_in_database: "already in the sentence bank",
  too_short: `fewer than ${MIN_WORDS} words`,
  too_long: `more than ${MAX_WORDS} words`,
  digits: "contains digits",
  url: "contains a web address",
  email: "contains an email address",
  abbreviation: "contains an all-caps abbreviation",
  blocklisted: "contains a blocklisted word",
};

export type RawRow = { line: number; text: string; topic?: string; difficulty?: string };
export type CleanRow = { line: number; text: string; topic: string | null; difficulty: number };
export type SkippedRow = { line: number; text: string; reason: SkipReason };

export type ImportSummary = {
  total: number;
  imported: number;
  skipped: Partial<Record<SkipReason, number>>;
  examples: SkippedRow[];
  dryRun: boolean;
};

const URL_PATTERN = /https?:\/\/|www\.|\b[\w-]+\.(?:com|org|net|edu|gov|io|co|info|africa|fr|uk|ng|ke|rw|tz)\b/i;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const DIGIT_PATTERN = /\p{Nd}/u;
const ABBREVIATION_PATTERN = /(?:^|[^\p{L}])\p{Lu}{2,}(?=$|[^\p{L}])/u;

/**
 * Cleans up a sentence: replaces typographic quotes with plain ones, removes
 * zero-width characters, collapses whitespace and strips quotes that wrap the
 * whole sentence.
 *
 * @param text Raw text.
 * @returns The cleaned text.
 */
export function normalizeText(text: string): string {
  let result = text
    .replace(/[​-‍﻿]/g, "")
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/\s+/gu, " ")
    .trim();
  if (/^"[^"]*"$/.test(result)) result = result.slice(1, -1).trim();
  return result;
}

/**
 * Builds the duplicate key used inside one file: lower case, letters, digits
 * and single spaces only. The database applies the same rule in
 * normalize_sentence().
 *
 * @param text Cleaned text.
 * @returns The comparison key.
 */
export function sentenceKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Counts the words in a sentence (tokens containing a letter or digit).
 *
 * @param text Cleaned text.
 * @returns Number of words.
 */
export function wordCount(text: string): number {
  return text.split(" ").filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * Gives a rough difficulty from sentence length.
 *
 * @param words Word count.
 * @returns 1 (≤4 words) to 5 (13+ words).
 */
export function difficultyFromWordCount(words: number): number {
  if (words <= 4) return 1;
  if (words <= 6) return 2;
  if (words <= 9) return 3;
  if (words <= 12) return 4;
  return 5;
}

/**
 * Parses a blocklist file: one word or phrase per line; blank lines and lines
 * starting with "#" are ignored.
 *
 * @param content File contents.
 * @returns Lower-case blocklist entries as comparison keys.
 */
export function parseBlocklist(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(sentenceKey)
    .filter(Boolean);
}

/**
 * Checks one cleaned sentence against the content rules (length, digits,
 * URLs, emails, abbreviations, blocklist). Duplicates are checked elsewhere.
 *
 * @param text      Cleaned text.
 * @param blocklist Entries from parseBlocklist().
 * @returns The first rule broken, or null if the sentence is acceptable.
 */
export function checkSentence(text: string, blocklist: string[]): SkipReason | null {
  if (!text) return "empty";
  const words = wordCount(text);
  if (words < MIN_WORDS) return "too_short";
  if (words > MAX_WORDS) return "too_long";
  if (EMAIL_PATTERN.test(text)) return "email";
  if (URL_PATTERN.test(text)) return "url";
  if (DIGIT_PATTERN.test(text)) return "digits";
  if (ABBREVIATION_PATTERN.test(text)) return "abbreviation";
  const padded = ` ${sentenceKey(text)} `;
  if (blocklist.some((entry) => padded.includes(` ${entry} `))) return "blocklisted";
  return null;
}

/**
 * Splits delimited text into rows of cells, honouring double-quoted cells
 * (with "" as an escaped quote) that may contain delimiters or newlines.
 *
 * @param content   File contents.
 * @param delimiter "," for CSV or "\t" for TSV.
 * @returns Rows of raw cells, each with its starting line number.
 */
function parseDelimited(content: string, delimiter: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      cells.push(cell);
      rows.push({ line: rowLine, cells });
      cells = [];
      cell = "";
      line++;
      rowLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || cells.length) {
    cells.push(cell);
    rows.push({ line: rowLine, cells });
  }
  return rows.filter((row) => row.cells.some((c) => c.trim() !== ""));
}

/**
 * Reads a sentence file. ".txt": one sentence per line. ".csv" / ".tsv":
 * columns text, topic (optional), difficulty (optional), with or without a
 * header row (a header is recognised when the first cell is "text").
 *
 * @param content  File contents.
 * @param fileName File name, used to pick the format from its extension.
 * @returns Raw rows with their line numbers.
 */
export function parseSentenceFile(content: string, fileName: string): RawRow[] {
  const text = content.replace(/^﻿/, "");
  const extension = fileName.toLowerCase().split(".").pop();

  if (extension !== "csv" && extension !== "tsv") {
    return text
      .split(/\r?\n/)
      .map((value, index) => ({ line: index + 1, text: value }))
      .filter((row) => row.text.trim() !== "");
  }

  const rows = parseDelimited(text, extension === "tsv" ? "\t" : ",");
  if (rows.length === 0) return [];

  let columns = { text: 0, topic: 1, difficulty: 2 };
  if (rows[0].cells[0]?.trim().toLowerCase() === "text") {
    const header = rows.shift()!.cells.map((c) => c.trim().toLowerCase());
    columns = { text: header.indexOf("text"), topic: header.indexOf("topic"), difficulty: header.indexOf("difficulty") };
  }

  return rows.map((row) => ({
    line: row.line,
    text: row.cells[columns.text] ?? "",
    topic: columns.topic >= 0 ? row.cells[columns.topic] : undefined,
    difficulty: columns.difficulty >= 0 ? row.cells[columns.difficulty] : undefined,
  }));
}

/**
 * Cleans and validates parsed rows: normalises text, applies the content
 * rules, removes duplicates within the file, tidies topics and fills in a
 * difficulty when none (or an invalid one) is given.
 *
 * @param rows      Rows from parseSentenceFile().
 * @param blocklist Entries from parseBlocklist().
 * @returns Accepted rows and skipped rows with their reasons.
 */
export function validateRows(rows: RawRow[], blocklist: string[]): { accepted: CleanRow[]; skipped: SkippedRow[] } {
  const accepted: CleanRow[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const text = normalizeText(row.text);
    const reason = checkSentence(text, blocklist);
    if (reason) {
      skipped.push({ line: row.line, text, reason });
      continue;
    }
    const key = sentenceKey(text);
    if (seen.has(key)) {
      skipped.push({ line: row.line, text, reason: "duplicate_in_file" });
      continue;
    }
    seen.add(key);

    const given = Number.parseInt(row.difficulty?.trim() ?? "", 10);
    const topic = row.topic ? normalizeText(row.topic).toLowerCase().slice(0, 50) : "";
    accepted.push({
      line: row.line,
      text,
      topic: topic || null,
      difficulty: given >= 1 && given <= 5 ? given : difficultyFromWordCount(wordCount(text)),
    });
  }
  return { accepted, skipped };
}

/**
 * Validates a sentence file and inserts the accepted sentences into the bank
 * as English anchor sentences. Works with a service-role client (import
 * script) or an admin's session (bulk upload page); duplicates against the
 * database are found with find_existing_sentences().
 *
 * @param client  Supabase client allowed to insert sentences.
 * @param content File contents.
 * @param options fileName, source, license, blocklist entries, dryRun.
 * @returns A summary: totals, skipped count per reason and the first skipped lines.
 */
export async function importSentences(
  client: SupabaseClient,
  content: string,
  options: { fileName: string; source: string; license: string; blocklist: string[]; dryRun?: boolean },
): Promise<ImportSummary> {
  const source = options.source.trim();
  const license = options.license.trim();
  if (!license) throw new Error("A licence is required.");
  if (!source) throw new Error("A source is required.");

  const rows = parseSentenceFile(content, options.fileName);
  const { accepted, skipped } = validateRows(rows, options.blocklist);

  const existing = new Set<string>();
  for (let i = 0; i < accepted.length; i += 500) {
    const batch = accepted.slice(i, i + 500).map((row) => row.text);
    const { data, error } = await client.rpc("find_existing_sentences", { p_texts: batch });
    if (error) throw new Error(`Could not check for existing sentences: ${error.message}`);
    for (const text of data as string[]) existing.add(text);
  }

  const fresh = accepted.filter((row) => {
    if (!existing.has(row.text)) return true;
    skipped.push({ line: row.line, text: row.text, reason: "already_in_database" });
    return false;
  });

  let imported = 0;
  if (!options.dryRun && fresh.length > 0) {
    const { data: english, error: langError } = await client.from("languages").select("id").eq("iso_code", "eng").single();
    if (langError || !english) throw new Error("English (eng) is missing from the languages table.");

    for (let i = 0; i < fresh.length; i += 500) {
      const { data, error } = await client
        .from("sentences")
        .upsert(
          fresh.slice(i, i + 500).map((row) => ({
            anchor_language_id: english.id,
            text: row.text,
            topic: row.topic,
            difficulty: row.difficulty,
            source,
            source_license: license,
          })),
          { onConflict: "anchor_language_id,normalized_text", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw new Error(`Insert failed: ${error.message}`);
      imported += data?.length ?? 0;
    }
  }

  skipped.sort((a, b) => a.line - b.line);
  const counts: Partial<Record<SkipReason, number>> = {};
  for (const row of skipped) counts[row.reason] = (counts[row.reason] ?? 0) + 1;

  return {
    total: rows.length,
    imported: options.dryRun ? fresh.length : imported,
    skipped: counts,
    examples: skipped.slice(0, 10),
    dryRun: Boolean(options.dryRun),
  };
}
