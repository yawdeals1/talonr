import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import {
  getPartialLeads,
  LoginChallengeError,
  RateLimitedError,
  type RawLead,
  type ScrapeSource,
} from "./types.js";

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
    viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
    locator: vi.fn(() => ({
      first: () => ({ boundingBox: vi.fn(async () => ({ x: 300, y: 0, width: 600, height: 720 })) }),
    })),
    mouse: {
      move: vi.fn(async () => undefined),
      wheel: vi.fn(async () => undefined),
    },
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

describe("scrollAndCollect stop handling", () => {
  beforeEach(() => {
    detectors.watchForRateLimitResponses.mockReturnValue(throttlePattern([0]));
  });

  it("does not even open the list page when the run has already been told to wrap up", async () => {
    // An "engagers" job runs two strategies through this function off one shared checkpoint, and a
    // run stopped by its own clock during the first must not spend a page load opening the second.
    const page = fakePage();
    const checkpoint = vi.fn(async () => "finish" as const);

    const leads = await scrollAndCollect(countingSource(), context(page, { checkpoint }));

    expect(leads).toEqual([]);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("keeps the leads collected before the run was told to wrap up", async () => {
    const page = fakePage();
    // Opens the page and runs one round, then wraps up: "finish" ends the search, it doesn't
    // discard what the search already found.
    let calls = 0;
    const checkpoint = vi.fn(async () => (calls++ < 2 ? ("continue" as const) : ("finish" as const)));

    const leads = await scrollAndCollect(countingSource(), context(page, { capLeads: 100, checkpoint }));

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(leads).toHaveLength(2);
  });
});

describe("scrollAndCollect timeline scrolling", () => {
  beforeEach(() => {
    detectors.watchForRateLimitResponses.mockReturnValue(throttlePattern([0]));
  });

  it("targets the primary timeline before wheeling and advances in viewport-sized steps", async () => {
    const page = fakePage();

    await scrollAndCollect(countingSource(), context(page));

    const move = page.mouse.move as unknown as ReturnType<typeof vi.fn>;
    const wheel = page.mouse.wheel as unknown as ReturnType<typeof vi.fn>;
    expect(move).toHaveBeenCalledWith(600, 360);
    expect(move.mock.invocationCallOrder[0]).toBeLessThan(wheel.mock.invocationCallOrder[0]!);
    expect(wheel.mock.calls[0]![1]).toBeGreaterThanOrEqual(600);
    expect(wheel.mock.calls[0]![1]).toBeLessThanOrEqual(720);
  });
});

/** Playwright's shape for a wait that ran out — what a `goto` or a `waitForSelector` throws. */
function timeoutError(message: string): Error {
  const err = new Error(message);
  err.name = "TimeoutError";
  return err;
}

describe("scrollAndCollect page opening", () => {
  beforeEach(() => {
    detectors.watchForRateLimitResponses.mockReturnValue(throttlePattern([0]));
    // The retry delay between attempts is seconds long in production; nothing here should wait it
    // out for real.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Runs the collector to completion with the retry delays fast-forwarded. */
  async function runFastForwarded(source: ScrapeSource, ctx: ReturnType<typeof context>) {
    const settled = scrollAndCollect(source, ctx).then(
      (leads) => ({ leads, err: null as unknown }),
      (err: unknown) => ({ leads: null, err })
    );
    await vi.advanceTimersByTimeAsync(120_000);
    return settled;
  }

  it("reports a page it never reached as unreachable, not as one that wouldn't render", async () => {
    // The failure this replaced: three identical 30s waits for DOMContentLoaded against a tweet
    // that opens fine in a browser, reported as "List page never rendered" — which points at the
    // wrong thing entirely, since the run never got a response to render.
    const page = fakePage();
    (page.goto as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      timeoutError("page.goto: Timeout 60000ms exceeded.")
    );

    const { err } = await runFastForwarded(countingSource(), context(page));

    expect(page.goto).toHaveBeenCalledTimes(3);
    expect((err as Error).message).toMatch(/Could not reach https:\/\/x\.com\/someone\/followers/);
  });

  it("waits for the response rather than for the whole document to parse", async () => {
    // X blocks DOMContentLoaded on its own bundle, so that bound failed pages the browser was
    // about to render. The source's own selector is the thing that says a list arrived.
    const page = fakePage();

    await runFastForwarded(countingSource(), context(page));

    expect(page.goto).toHaveBeenCalledWith(
      "https://x.com/someone/followers",
      expect.objectContaining({ waitUntil: "commit" })
    );
  });

  it("opens on a retry when the first navigation times out", async () => {
    const page = fakePage();
    const goto = page.goto as unknown as ReturnType<typeof vi.fn>;
    goto.mockRejectedValueOnce(timeoutError("page.goto: Timeout 60000ms exceeded."));

    const { leads } = await runFastForwarded(countingSource(), context(page));

    expect(goto).toHaveBeenCalledTimes(2);
    expect(leads).toHaveLength(4);
  });

  it("names the account signal behind a list that never appeared", async () => {
    // The health check at commit time runs before the SPA has drawn anything, so a login wall
    // where the list should be first shows up as a render timeout. Re-asking is what keeps it from
    // being retried as a slow page against an account X has stopped trusting.
    detectors.checkHealth
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new LoginChallengeError("https://x.com/i/flow/login"));
    const source: ScrapeSource = {
      ...countingSource(),
      waitForReady: async () => {
        throw timeoutError("waitForSelector: Timeout 30000ms exceeded.");
      },
    };

    const { err } = await runFastForwarded(source, context(fakePage()));

    expect(err).toBeInstanceOf(LoginChallengeError);
  });

  it("stops retrying when the run is told to wrap up between attempts", async () => {
    // Three attempts at a page X isn't serving run into minutes — long enough that a cancel or the
    // run's own clock must land here rather than only once the retries are spent.
    const page = fakePage();
    (page.goto as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      timeoutError("page.goto: Timeout 60000ms exceeded.")
    );
    const checkpoint = vi.fn(async () => "continue" as const);
    checkpoint.mockResolvedValueOnce("continue" as const).mockResolvedValue("finish" as const);

    const { leads, err } = await runFastForwarded(countingSource(), context(page, { checkpoint }));

    expect(err).toBeNull();
    expect(leads).toEqual([]);
    expect(page.goto).toHaveBeenCalledTimes(1);
  });
});
