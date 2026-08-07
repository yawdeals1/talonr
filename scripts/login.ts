/**
 * Interactive X login capture — must run locally with a real display (headless servers can't
 * complete a manual login/2FA/captcha flow).
 *
 * Usage:
 *   npm run login:x -- --userId <uuid> --handle <handle> [--proxy http://user:pass@host:port]
 */
import { chromium } from "playwright";
import { studioInsert, studioList, studioUpdate } from "../src/db/studio-client.js";
import type { XAccount } from "../src/db/schema.js";
import { encryptProxy, encryptSession, type ProxyConfig } from "../src/scraper/session-store.js";

interface Args {
  userId: string;
  handle: string;
  proxy?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--userId") out.userId = argv[++i];
    else if (arg === "--handle") out.handle = argv[++i];
    else if (arg === "--proxy") out.proxy = argv[++i];
  }
  if (!out.userId || !out.handle) {
    throw new Error("Usage: npm run login:x -- --userId <uuid> --handle <handle> [--proxy <url>]");
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

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
  });
  const page = await context.newPage();
  await page.goto("https://x.com/login");

  console.log(`Log in as @${args.handle} in the opened browser window.`);
  console.log("Complete any 2FA/captcha manually. Waiting up to 5 minutes for /home...");
  await page.waitForURL(/x\.com\/home/, { timeout: 5 * 60 * 1000 });

  const storageState = await context.storageState();
  const encryptedSession = encryptSession(storageState);
  const encryptedProxy = proxy ? encryptProxy(proxy) : null;

  const { rows } = await studioList<XAccount>("x_accounts", {
    filter: { userId: args.userId, handle: args.handle },
    limit: 1,
  });
  const fields = { encryptedSession, encryptedProxy, status: "active" as const };
  if (rows[0]) {
    await studioUpdate<XAccount>("x_accounts", rows[0].id, { ...fields, lastUsedAt: new Date() });
  } else {
    await studioInsert<XAccount>("x_accounts", { userId: args.userId, handle: args.handle, ...fields });
  }

  console.log(`Saved session for @${args.handle}.`);

  await browser.close();
}

main().catch((err) => {
  console.error("Login capture failed:", err);
  process.exit(1);
});
