import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { getPartialLeads, RateLimitedError, type RawLead, type ScrapeSource } from "./types.js";

const detectors = vi.hoisted(() => ({
  checkHealth: vi.fn(async () => undefined),
  watchForRateLimitResponses: vi.fn(),
}));
vi.mock("./detectors.js", () => detectors);

const { scrollAndCollect } = await import("./scroll-collector.js");

/**
 * Drives the 429 counter the collector reads between rounds. Each entry is what `take()` reports
 * for one round; the last entry repeats once the list runs out.
 */
function throttlePattern(counts: number[]) {
  let index = 0;
  return {
    take: () => counts[Math.min(index++, counts.length - 1)] ?? 0,
    stop: vi.fn(),
  };
}

function fakePage(): Page {
  return {
    goto: vi.fn(async () => null),
    mouse: { wheel: vi.fn(async () => undefined) },
  } as unknown as Page;
}

/** Yields two fresh handles per round, so a round that actually extracts is never stagnant. */
function countingSource(): ScrapeSource {
  let round = 0;
  return {
    buildUrl: () => "https://x.com/someone/followers",
    waitForReady: async () => undefined,
    extractVisibleItems: async () => {
      round += 1;
      return [`a${round}`, `b${round}`].map(
        (handle): RawLead => ({
          handle,
          displayName: handle,
          bio: null,
          followers: null,
          location: null,
          verified: false,
          profileImage: null,
        })
      );
    },
  };
}

function context(page: Page, overrides: Record<string, unknown> = {}) {
  return {
    page,
    sourceRef: "someone",
    capLeads: 4,
    minScrollDelayMs: 1,
    maxScrollDelayMs: 1,
    rateLimitTolerance: 3,
    rateLimitBackoffMs: 5,
    ...overrides,
  };
}

beforeEach(() => {
  detectors.checkHealth.mockClear();
  detectors.checkHealth.mockResolvedValue(undefined);
});

describe("scrollAndCollect rate-limit handling", () => {
  it("backs off and carries on when a single stray 429 shows up", async () => {
    // X's SPA fires background requests that have nothing to do with the list being scraped. One of
    // them being throttled used to latch a flag that ended the run — and, before rate limits became
    // a cooldown, checkpointed the account and cost a full interactive re-login.
    detectors.watchForRateLimitResponses.mockReturnValue(throttlePattern([1, 0]));

    const leads = await scrollAndCollect(countingSource(), context(fakePage()));

    expect(leads).toHaveLength(4);
  });

  it("gives up only once several consecutive rounds come back throttled", async () => {
    detectors.watchForRateLimitResponses.mockReturnValue(throttlePattern([1]));

    await expect(scrollAndCollect(countingSource(), context(fakePage()))).rejects.toBeInstanceOf(
      RateLimitedError
    );
  });

  it("keeps the leads it had collected when it does give up", async () => {
    // Two clean rounds first, then nothing but throttling: what was already collected has to ride
    // out on the error so the stopped job reports it instead of 0.
    detectors.watchForRateLimitResponses.mockReturnValue(throttlePattern([0, 0, 1]));

    const err = await scrollAndCollect(countingSource(), context(fakePage(), { capLeads: 100 })).catch(
      (caught: unknown) => caught
    );

    expect(err).toBeInstanceOf(RateLimitedError);
    expect(getPartialLeads(err)).toHaveLength(4);
  });

  it("answers a cancel raised while it is waiting out a throttle", async () => {
    // Back-offs run into the tens of seconds in production; sleeping through one in a single call
    // would leave a cancel unanswered for that whole time.
    detectors.watchForRateLimitResponses.mockReturnValue(throttlePattern([1]));
    const checkpoint = vi.fn(async () => "continue" as const);

    await expect(
      scrollAndCollect(
        countingSource(),
        context(fakePage(), { rateLimitBackoffMs: 40, checkpoint })
      )
    ).rejects.toBeInstanceOf(RateLimitedError);

    // Consulted more often than once per round — the extra calls are the back-off's slices.
    expect(checkpoint.mock.calls.length).toBeGreaterThan(3);
  });
});
