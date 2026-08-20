import type { Page } from "playwright";
import { CaptchaDetectedError, LoginChallengeError, RateLimitedError, TransientPageError } from "./types.js";

const CHALLENGE_URL_PATTERN = /\/(login|i\/flow\/login|account\/access|i\/flow\/lockdown|challenge)/;

/**
 * Phrases X uses when it is actually throttling the session.
 *
 * Kept narrow on purpose. A match here checkpoints the X account, which is terminal for the job and
 * can only be undone by re-running the interactive login script — so a false positive costs far
 * more than a missed detection, and a real throttle gets caught again on the next scroll round or
 * by the HTTP-429 watcher below.
 */
const RATE_LIMIT_PATTERN =
  /\b(rate.?limit(ed|s|ing)?|too many requests|over the daily limit|exceeded your [a-z ]{0,20}limit)\b/i;

/** X's generic client-side error boundary. Not a throttling signal — see TransientPageError. */
const TRANSIENT_ERROR_PATTERN = /something went wrong|try reloading|please try again/i;

export interface PageSignals {
  rateLimit: string | null;
  transient: string | null;
}

const NO_SIGNALS: PageSignals = { rateLimit: null, transient: null };

/**
 * Collects the page's own status/error text — the candidate signals checkHealth classifies.
 *
 * Runs inside the browser (passed to `page.evaluate`), so it must stay self-contained: no imports,
 * no closure over module scope.
 *
 * The predecessor of this was `page.getByText(/rate limit|.../i).count() > 0`, which matched the
 * whole document including hidden nodes and, critically, user-generated content. A followers page
 * renders hundreds of bios; one lead whose bio mentioned rate limits was indistinguishable from X
 * telling us to back off, and checkpointed the scraping account. So the scan:
 *
 *   1. skips user content (cells, bios, tweets, display names, the recommendation sidebar),
 *   2. requires the text to actually be rendered — hidden error boundaries X keeps mounted are not
 *      evidence of anything,
 *   3. reads individual text nodes rather than accumulated `textContent`, so a match can't come
 *      from two unrelated strings concatenated by a common ancestor.
 */
export function collectSignalSnippets(): string[] {
  const USER_CONTENT = [
    '[data-testid="UserCell"]',
    '[data-testid="UserDescription"]',
    '[data-testid="tweetText"]',
    '[data-testid="tweet"]',
    '[data-testid="User-Name"]',
    '[data-testid="UserName"]',
    '[data-testid="sidebarColumn"]',
    "article",
  ].join(",");

  const SKIP_TAGS = ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE"];
  const MAX_SNIPPET_LENGTH = 200;
  const MAX_SNIPPETS = 400;

  function isRendered(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  const snippets: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ? node.textContent.trim() : "";
    // X's notices are short banners. The bound also keeps inline JSON/config blobs out.
    if (!text || text.length > MAX_SNIPPET_LENGTH) continue;

    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.indexOf(parent.tagName) !== -1) continue;
    if (parent.closest(USER_CONTENT)) continue;
    if (!isRendered(parent)) continue;

    snippets.push(text);
    if (snippets.length >= MAX_SNIPPETS) break;
  }

  return snippets;
}

/** Classifies collected page text into a throttling signal, a retryable one, or neither. */
export function classifyPageSignals(snippets: string[]): PageSignals {
  return {
    rateLimit: snippets.find((text) => RATE_LIMIT_PATTERN.test(text)) ?? null,
    transient: snippets.find((text) => TRANSIENT_ERROR_PATTERN.test(text)) ?? null,
  };
}

async function readPageSignals(page: Page): Promise<PageSignals> {
  try {
    return classifyPageSignals(await page.evaluate(collectSignalSnippets));
  } catch {
    // The page navigated out from under the evaluate, or the context was torn down. A probe that
    // couldn't run is not a signal — never checkpoint an account on it.
    return NO_SIGNALS;
  }
}

/**
 * Checks the current page for login walls, captchas, or rate-limit signals; throws a typed error if
 * found. `TransientPageError` is retryable by the caller; the rest are terminal account-health
 * errors that checkpoint the account.
 */
export async function checkHealth(page: Page): Promise<void> {
  const url = page.url();
  if (CHALLENGE_URL_PATTERN.test(url)) {
    throw new LoginChallengeError(url);
  }

  const captchaFrame = await page.$('iframe[src*="arkoselabs"], iframe[title*="challenge" i]');
  if (captchaFrame) {
    throw new CaptchaDetectedError();
  }

  const signals = await readPageSignals(page);
  if (signals.rateLimit) {
    throw new RateLimitedError(`X is throttling this session: "${signals.rateLimit}"`);
  }
  if (signals.transient) {
    throw new TransientPageError(signals.transient);
  }
}

/**
 * Counts HTTP 429 responses as they arrive, so a run can tell one stray throttled request apart
 * from X actually pushing back on the session.
 *
 * This used to hand the caller a single latched status: the first 429 on *any* response set a flag
 * that was never cleared, and the next loop iteration ended the run. X's SPA fires a lot of
 * background requests that have nothing to do with the list being scraped, so one of them getting
 * throttled killed an entire scrape — and, before rate limits became a cooldown, the account with
 * it. Callers now read the count between rounds, back off while it is non-zero, and only escalate
 * once several rounds in a row come back throttled.
 */
export interface RateLimitWatcher {
  /** 429s seen since the last call, resetting the count. */
  take(): number;
  /** Detaches the listener. */
  stop(): void;
}

export function watchForRateLimitResponses(page: Page): RateLimitWatcher {
  let seen = 0;

  const handler = (response: import("playwright").Response) => {
    if (response.status() === 429) seen += 1;
  };
  page.on("response", handler);

  return {
    take() {
      const count = seen;
      seen = 0;
      return count;
    },
    stop() {
      page.off("response", handler);
    },
  };
}
