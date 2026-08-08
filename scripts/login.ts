/**
 * Interactive X login capture — runs standalone: only needs Node 20+, the `playwright` package,
 * and network access to a running Talonr deployment. Deliberately does NOT need this repo checked
 * out, this project's .env, or its Studio DB / encryption secrets — those belong to the operator,
 * not to whichever user is connecting their own X account. Authentication is a short-lived,
 * account-scoped connect token minted by the web app's "Finish connecting" screen (which also
 * gives you --endpoint and --token), verified server-side in accounts.controller.ts#saveSession.
 * You can copy just this file to a machine with no access to the rest of the repo and run it with
 * `npm install playwright && npx tsx login.ts ...`.
 *
 * Two modes:
 *
 *   npx tsx login.ts --endpoint <url> --token <connect-token> --handle <handle> \
 *     [--proxy http://user:pass@host:port]
 *
 *   Drives an interactive login in a real (headed) browser window. Works for most accounts, but
 *   X's own bot/fraud detection (Arkose Labs, Socure) sometimes blocks *any* CDP-automated login
 *   attempt outright — confirmed to happen even in a real Chrome binary with no other automation
 *   involved. That's a deliberate anti-bot security control on X's side, not a bug here, and this
 *   script won't try to spoof or evade it.
 *
 *   npx tsx login.ts --endpoint <url> --token <connect-token> --handle <handle> --import-cookies
 *
 *   Use this if the above gets blocked. Skips driving a login entirely — instead prompts you to
 *   paste a few specific cookie values copied out of a regular (non-automated) browser you're
 *   already logged into X with (DevTools -> Application -> Cookies -> https://x.com). Only those
 *   specific values are read; nothing else about that browser or profile is touched.
 */
import { chromium } from "playwright";
import { createInterface } from "node:readline/promises";

interface Args {
  endpoint: string;
  token: string;
  handle: string;
  proxy?: string;
  importCookies: boolean;
}

interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

interface StorageState {
  cookies: CookieEntry[];
  origins: unknown[];
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { importCookies: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--endpoint") out.endpoint = argv[++i];
    else if (arg === "--token") out.token = argv[++i];
    else if (arg === "--handle") out.handle = argv[++i];
    else if (arg === "--proxy") out.proxy = argv[++i];
    else if (arg === "--import-cookies") out.importCookies = true;
  }
  out.endpoint ??= process.env.TALONR_CONNECT_ENDPOINT;
  out.token ??= process.env.TALONR_CONNECT_TOKEN;
  if (!out.endpoint || !out.token || !out.handle) {
    throw new Error(
      "Usage: login.ts --endpoint <url> --token <connect-token> --handle <handle> [--proxy <url>] [--import-cookies]\n" +
        'Get --endpoint/--token from the "Finish connecting" screen in the Talonr web app — they expire after 15 minutes.'
    );
  }
  return out as Args;
}

function parseProxyUrl(proxyUrl: string): ProxyConfig {
  const url = new URL(proxyUrl);
  return {
    server: `${url.protocol}//${url.host}`,
    username: url.username || undefined,
    password: url.password || undefined,
  };
}

async function captureViaAutomatedLogin(handle: string, proxy: ProxyConfig | null): Promise<StorageState> {
  // channel: "chrome" launches the real, locally installed Chrome rather than Playwright's
  // bundled Chromium build. This does NOT get around X's or Google's automation detection —
  // both block CDP-controlled sessions regardless of which Chrome binary is underneath — it's
  // just still the better default for everything else about this session. Requires
  // `npx playwright install chrome` once.
  let browser;
  try {
    browser = await chromium.launch({ headless: false, channel: "chrome" });
  } catch (err) {
    throw new Error(
      `Failed to launch Chrome: ${err instanceof Error ? err.message : String(err)}\n` +
        "Run `npx playwright install chrome` and try again."
    );
  }
  const context = await browser.newContext({
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
  });
  const page = await context.newPage();
  await page.goto("https://x.com/login");

  console.log(`Log in as @${handle} in the opened browser window.`);
  console.log(
    'Use "Log in" with your X username/password, NOT "Continue with Google" — Google blocks ' +
      "automated browser sessions outright and it will fail with \"This browser or app may not be secure\", " +
      "even in real Chrome. If this account only has Google sign-in, set an X password first: log in " +
      "normally in a regular (non-automated) browser, then Settings -> Your account -> Change password."
  );
  console.log(
    "If X itself blocks the login (e.g. Continue does nothing, or DevTools shows CSP/script errors " +
      "around arkoselabs.com or socure.io), re-run this script with --import-cookies instead."
  );
  console.log("Complete any 2FA/captcha manually. Waiting up to 5 minutes for /home...");
  await page.waitForURL(/x\.com\/home/, { timeout: 5 * 60 * 1000 });

  const storageState = await context.storageState();
  await browser.close();
  return storageState;
}

const REQUIRED_COOKIES = ["auth_token", "ct0"] as const;
const OPTIONAL_COOKIES = ["twid", "guest_id"] as const;

async function captureViaCookieImport(): Promise<StorageState> {
  console.log("Cookie import mode.");
  console.log(
    "In a REGULAR (non-automated) browser you're already logged into X with, open DevTools " +
      "(F12) -> Application tab -> Cookies -> https://x.com, and copy the Value column for each " +
      "cookie below. Only these specific values are read — nothing else about that browser is touched.\n"
  );

  // Deliberately not repeated rl.question() calls: readline silently closes after the first one
  // resolves when stdin isn't backed by a real TTY (piped/redirected input), and every later
  // question() then hangs forever with no error — confirmed while testing this. The async
  // iterator form below is Node's own documented pattern for reading multiple sequential lines
  // and doesn't have that failure mode, for either a real terminal or piped input.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  async function ask(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    const { value, done } = await lines.next();
    if (done) throw new Error("Input ended before all values were provided.");
    return value.trim();
  }

  const values: Record<string, string> = {};
  try {
    for (const name of REQUIRED_COOKIES) {
      const value = await ask(`${name} (required): `);
      if (!value) throw new Error(`${name} is required.`);
      values[name] = value;
    }
    for (const name of OPTIONAL_COOKIES) {
      const value = await ask(`${name} (optional, Enter to skip): `);
      if (value) values[name] = value;
    }
  } finally {
    rl.close();
  }

  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const cookies: CookieEntry[] = Object.entries(values).map(([name, value]) => ({
    name,
    value,
    domain: ".x.com",
    path: "/",
    expires,
    httpOnly: name === "auth_token",
    secure: true,
    sameSite: "Lax",
  }));

  return { cookies, origins: [] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const proxy = args.proxy ? parseProxyUrl(args.proxy) : null;

  const storageState = args.importCookies
    ? await captureViaCookieImport()
    : await captureViaAutomatedLogin(args.handle, proxy);

  const res = await fetch(args.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify({ storageState, proxy }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to save session (${res.status}): ${body || res.statusText}\n` +
        "If the token expired, go back to the Talonr web app and reopen \"Finish connecting\" for a fresh one."
    );
  }

  console.log(`Saved session for @${args.handle}. The account is now active in the Talonr dashboard.`);
}

main().catch((err) => {
  console.error("Login capture failed:", err);
  process.exit(1);
});
