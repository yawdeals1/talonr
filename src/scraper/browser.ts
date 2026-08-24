import { chromium, type Browser, type BrowserContext } from "playwright";
import type { ProxyConfig } from "./session-store.js";

export interface ScrapeSession {
  browser: Browser;
  context: BrowserContext;
}

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export async function launchScrapeSession(
  storageState: StorageState,
  proxy: ProxyConfig | null
): Promise<ScrapeSession> {
  // shm_size is bumped to 1gb in docker-compose.yml, but Chromium's renderer still reaches for
  // /dev/shm for buffers outside that allowance and can crash ("Target crashed") on a media-heavy
  // page — --disable-dev-shm-usage routes it to /tmp instead. --disable-gpu avoids GPU-accelerated
  // compositing crashes on a headless VPS with no real GPU, where software rendering is what runs
  // either way.
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-gpu"],
  });
  const context = await browser.newContext({
    storageState,
    proxy: proxy
      ? { server: proxy.server, username: proxy.username, password: proxy.password }
      : undefined,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  return { browser, context };
}

export async function closeScrapeSession(session: ScrapeSession): Promise<void> {
  await session.context.close();
  await session.browser.close();
}
