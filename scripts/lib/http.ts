import { spawn, type ChildProcess } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";

export type App = { baseUrl: string; stop: () => void };

/**
 * Waits for a URL to answer, polling once a second.
 *
 * @param url       The URL to poll.
 * @param timeoutMs How long to wait before giving up.
 * @returns True if it answered in time.
 */
async function waitFor(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * Uses the running app at VERIFY_APP_URL (default http://localhost:3000) if
 * it answers; otherwise starts `next dev` on port 3100 for the duration of
 * the checks.
 *
 * @returns The base URL and a stop() function (a no-op for an app we did not start).
 */
export async function ensureApp(): Promise<App> {
  const existing = process.env.VERIFY_APP_URL ?? "http://localhost:3000";
  if (await waitFor(`${existing}/languages`, 2000)) return { baseUrl: existing, stop: () => {} };

  const port = process.env.VERIFY_APP_PORT ?? "3100";
  const child: ChildProcess = spawn("npx", ["next", "dev", "--port", port], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
    detached: true,
  });
  const baseUrl = `http://localhost:${port}`;
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already stopped */
    }
  };
  if (!(await waitFor(`${baseUrl}/languages`, 120_000))) {
    stop();
    throw new Error(`Could not start the app on ${baseUrl}`);
  }
  return { baseUrl, stop };
}

/**
 * Decodes the HTML entities React uses in attribute values.
 *
 * @param value Attribute value from server-rendered HTML.
 * @returns The decoded value.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * A minimal cookie-keeping HTTP client that behaves like a browser without
 * JavaScript: it follows no redirects automatically, so checks can inspect them.
 */
export class Browser {
  private readonly cookies = new Map<string, string>();

  /**
   * @param baseUrl Base URL of the app, e.g. "http://localhost:3100".
   */
  constructor(readonly baseUrl: string) {}

  /**
   * Sends a request with the stored cookies and stores any cookies set.
   *
   * @param path Path (and query) on the app.
   * @param init Fetch options.
   * @returns Status, Location header and body text.
   */
  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(this.baseUrl + path, { ...init, headers, redirect: "manual" });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      const expired = attributes.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return { status: res.status, location: res.headers.get("location"), body: await res.text() };
  }

  /**
   * GET a page.
   *
   * @param path Path (and query).
   * @returns Status, Location header and body text.
   */
  get(path: string) {
    return this.request(path);
  }

  /**
   * Signs in as an existing user through the real email-link route, using a
   * one-time token from the admin API instead of reading an inbox.
   *
   * @param admin Service-role client.
   * @param email The user's email.
   * @param extra Extra query string for /auth/confirm (e.g. "&next=/profile").
   * @returns The response from /auth/confirm (a redirect on success).
   */
  async signIn(admin: SupabaseClient, email: string, extra = "") {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data.properties?.hashed_token) throw new Error(`generateLink failed: ${error?.message}`);
    return this.get(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=email${extra}`);
  }

  /**
   * Calls a server action the way the page's own JavaScript does: finds the
   * action's id in the page's client scripts, then posts the arguments with
   * the Next-Action header and reads the result from the response.
   *
   * @param path       Page whose client code uses the action.
   * @param actionName Exported name of the action, e.g. "submitTranslation".
   * @param args       Arguments to pass (JSON-serialisable).
   * @returns The value the action returned.
   */
  async callAction(path: string, actionName: string, args: unknown[]): Promise<unknown> {
    const page = await this.get(path);
    const scripts = [...page.body.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => decodeEntities(m[1]));
    const pattern = new RegExp(
      `createServerReference\\)\\(\\\\?"([0-9a-f]{40,})\\\\?"[\\s\\S]{0,400}?\\\\?"${actionName}\\\\?"\\)`,
    );
    let actionId: string | undefined;
    for (const src of scripts) {
      const js = await (await fetch(new URL(src, this.baseUrl))).text();
      actionId = pattern.exec(js)?.[1];
      if (actionId) break;
    }
    if (!actionId) throw new Error(`Server action ${actionName} not found on ${path}`);

    const res = await this.request(path, {
      method: "POST",
      body: JSON.stringify(args),
      headers: {
        "next-action": actionId,
        "content-type": "text/plain;charset=UTF-8",
        accept: "text/x-component",
        origin: this.baseUrl,
      },
    });
    const line = res.body.split("\n").find((l) => l.startsWith("1:"));
    if (!line) throw new Error(`Unexpected action response (${res.status}): ${res.body.slice(0, 200)}`);
    return JSON.parse(line.slice(2));
  }

  /**
   * Submits a server-rendered form the way a browser without JavaScript
   * would: copies every hidden field from the form that contains the given
   * field name, adds the given values and posts it to the same page.
   *
   * @param path       Page that renders the form.
   * @param fieldName  A field that identifies the form (e.g. "confirm").
   * @param values     Values to fill in.
   * @param near       Optional text inside the wanted form (e.g. a button
   *                   label) when several forms share the field name.
   * @returns The response to the submission.
   */
  async submitForm(path: string, fieldName: string, values: Record<string, string>, near?: string) {
    const page = await this.get(path);
    const marker = page.body.indexOf(near ?? `name="${fieldName}"`);
    if (marker < 0) throw new Error(`No form with "${near ?? fieldName}" on ${path} (status ${page.status})`);
    const start = page.body.lastIndexOf("<form", marker);
    const end = page.body.indexOf("</form>", marker);
    const formHtml = page.body.slice(start, end);

    const body = new FormData();
    for (const match of formHtml.matchAll(/<input\b([^>]*)>/g)) {
      const attrs = match[1];
      const name = /\bname="([^"]*)"/.exec(attrs)?.[1];
      const type = /\btype="([^"]*)"/.exec(attrs)?.[1];
      if (!name || type !== "hidden") continue;
      body.append(decodeEntities(name), decodeEntities(/\bvalue="([^"]*)"/.exec(attrs)?.[1] ?? ""));
    }
    for (const [name, value] of Object.entries(values)) body.set(name, value);

    return this.request(path, { method: "POST", body, headers: { origin: this.baseUrl } });
  }
}
