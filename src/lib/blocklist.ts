import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseBlocklist } from "@/lib/sentence-import";

/**
 * Loads config/blocklist.txt for server-side sentence validation. A missing
 * file means an empty blocklist.
 *
 * @returns Blocklist entries as comparison keys.
 */
export async function loadBlocklist(): Promise<string[]> {
  const content = await readFile(path.join(process.cwd(), "config", "blocklist.txt"), "utf8").catch(() => "");
  return parseBlocklist(content);
}
