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
 * Usage:
 *   npx tsx login.ts --endpoint <url> --token <connect-token> --handle <handle> \
 *     [--proxy http://user:pass@host:port]
 */
import { chromium } from "playwright";

interface Args {
  endpoint: string;
  token: string;
  handle: string;
  proxy?: string;
}

interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--endpoint") out.endpoint = argv[++i];
    else if (arg === "--token") out.token = argv[++i];
    else if (arg === "--handle") out.handle = argv[++i];
    else if (arg === "--proxy") out.proxy = argv[++i];
  }
  out.endpoint ??= process.env.TALONR_CONNECT_ENDPOINT;
  out.token ??= process.env.TALONR_CONNECT_TOKEN;
  if (!out.endpoint || !out.token || !out.handle) {
    throw new Error(
      "Usage: login.ts --endpoint <url> --token <connect-token> --handle <handle> [--proxy <url>]\n" +
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const proxy = args.proxy ? parseProxyUrl(args.proxy) : null;

  // channel: "chrome" launches the real, locally installed Chrome rather than Playwright's
  // bundled Chromium build. This does NOT get "Continue with Google" working — Google's OAuth
  // deliberately blocks any CDP-automated session (Playwright/Selenium/Puppeteer alike),
  // regardless of which Chrome binary is underneath, as an anti-bot security control. The real
  // fix is telling the user to use X's own username/password login instead (see the console.log
  // below) — channel: "chrome" is kept anyway since it's still the better default for everything
  // else about this session. Requires `npx playwright install chrome` once.
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

  console.log(`Log in as @${args.handle} in the opened browser window.`);
  console.log(
    'Use "Log in" with your X username/password, NOT "Continue with Google" — Google blocks ' +
      "automated browser sessions outright and it will fail with \"This browser or app may not be secure\", " +
      "even in real Chrome. If this account only has Google sign-in, set an X password first: log in " +
      "normally in a regular (non-automated) browser, then Settings -> Your account -> Change password."
  );
  console.log("Complete any 2FA/captcha manually. Waiting up to 5 minutes for /home...");
  await page.waitForURL(/x\.com\/home/, { timeout: 5 * 60 * 1000 });

  const storageState = await context.storageState();
  await browser.close();

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
