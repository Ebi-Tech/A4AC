import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type ConsentBlock =
  | { kind: "h1" | "h2" | "p"; text: string }
  | { kind: "ul"; items: string[] };

export type Consent = { version: string; blocks: ConsentBlock[] };

const CONSENT_FILE = path.join(process.cwd(), "content", "consent.md");

/**
 * Parses the small Markdown subset used by content/consent.md: a leading
 * "version: ..." line, "#" and "##" headings, "- " bullet lists and paragraphs
 * separated by blank lines. Kept tiny so no Markdown library is shipped.
 *
 * @param source The raw file contents.
 * @returns The consent version and the content as typed blocks.
 */
export function parseConsent(source: string): Consent {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const versionMatch = /^version:\s*(.+)$/.exec(lines[0]?.trim() ?? "");
  if (!versionMatch) {
    throw new Error('content/consent.md must start with a "version: ..." line');
  }

  const blocks: ConsentBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join(" ") });
    if (list.length) blocks.push({ kind: "ul", items: list });
    paragraph = [];
    list = [];
  };

  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "h2", text: line.slice(3) });
    } else if (line.startsWith("# ")) {
      flush();
      blocks.push({ kind: "h1", text: line.slice(2) });
    } else if (line.startsWith("- ")) {
      if (paragraph.length) flush();
      list.push(line.slice(2));
    } else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  flush();

  return { version: versionMatch[1].trim(), blocks };
}

/**
 * Reads and parses content/consent.md from disk.
 *
 * @returns The current consent text and its version.
 */
export async function loadConsent(): Promise<Consent> {
  return parseConsent(await readFile(CONSENT_FILE, "utf8"));
}
