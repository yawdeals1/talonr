import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { checkHealth, classifyPageSignals } from "./detectors.js";
import { CaptchaDetectedError, LoginChallengeError, RateLimitedError, TransientPageError } from "./types.js";

/**
 * Stands in for the parts of Playwright's Page that checkHealth touches. `snippets` is what the
 * in-page scan returns: the visible, non-user-content text nodes on the page.
 *
 * Note the split in coverage. Which *elements* get scanned (bios, tweets and the recommendation
 * sidebar are excluded; hidden nodes are excluded) lives in `collectSignalSnippets`, which needs a
 * real DOM and is only exercised against a live page. What the collected text *means* is
 * `classifyPageSignals`, covered directly below.
 */
function fakePage(options: {
  url?: string;
  captcha?: boolean;
  snippets?: string[];
  evaluateThrows?: boolean;
}): Page {
  return {
    url: () => options.url ?? "https://x.com/someone/followers",
    $: vi.fn(async () => (options.captcha ? {} : null)),
    evaluate: vi.fn(async () => {
      if (options.evaluateThrows) throw new Error("Execution context was destroyed");
      return options.snippets ?? [];
    }),
  } as unknown as Page;
}

async function captureError(page: Page): Promise<unknown> {
  try {
    await checkHealth(page);
    return null;
  } catch (err) {
    return err;
  }
}

describe("classifyPageSignals", () => {
  it.each([
    "Rate limit exceeded",
    "You are rate limited. Please wait a few moments then try again.",
    "Too many requests",
    "You are over the daily limit for sending Tweets.",
  ])("treats %j as throttling", (text) => {
    expect(classifyPageSignals([text]).rateLimit).toBe(text);
  });

  // The regression this change exists for. X's generic error boundary was classified as a rate
  // limit, so a page that had merely failed to hydrate yet — the single most common thing on screen
  // at `domcontentloaded`, when the first checkHealth runs — checkpointed the scraping account.
  it.each(["Something went wrong. Try reloading.", "Something went wrong, please try again", "Please try again"])(
    "treats %j as transient rather than throttling",
    (text) => {
      const signals = classifyPageSignals([text]);
      expect(signals.rateLimit).toBeNull();
      expect(signals.transient).toBe(text);
    }
  );

  it.each([
    ["Followers", "Following", "Follow", "Subscribe"],
    ["Trending now", "Who to follow", "Show more"],
    ["Hmm...this page doesn't exist. Try searching for something else."],
  ])("reports no signal for ordinary chrome %#", (...snippets) => {
    expect(classifyPageSignals(snippets)).toEqual({ rateLimit: null, transient: null });
  });

  it("reports the first matching snippet so the job records what X actually said", () => {
    const signals = classifyPageSignals(["Home", "Rate limit exceeded", "Rate limit exceeded"]);
    expect(signals.rateLimit).toBe("Rate limit exceeded");
  });
});

describe("checkHealth", () => {
  it("throws LoginChallengeError on a challenge URL", async () => {
    await expect(checkHealth(fakePage({ url: "https://x.com/i/flow/login" }))).rejects.toBeInstanceOf(
      LoginChallengeError
    );
  });

  it("throws CaptchaDetectedError when a challenge iframe is present", async () => {
    await expect(checkHealth(fakePage({ captcha: true }))).rejects.toBeInstanceOf(CaptchaDetectedError);
  });

  it("passes a healthy followers page", async () => {
    await expect(checkHealth(fakePage({ snippets: ["Followers", "Follow", "Trending now"] }))).resolves.toBeUndefined();
  });

  it("throws RateLimitedError, quoting X's wording, when actually throttled", async () => {
    const err = await captureError(fakePage({ snippets: ["Rate limit exceeded"] }));
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as Error).message).toContain("Rate limit exceeded");
  });

  it("throws the retryable TransientPageError for X's error boundary, not a checkpoint", async () => {
    const err = await captureError(fakePage({ snippets: ["Something went wrong. Try reloading."] }));
    expect(err).toBeInstanceOf(TransientPageError);
    expect(err).not.toBeInstanceOf(RateLimitedError);
  });

  it("reports nothing when the in-page probe fails — a probe that could not run is not a signal", async () => {
    await expect(checkHealth(fakePage({ evaluateThrows: true }))).resolves.toBeUndefined();
  });
});
