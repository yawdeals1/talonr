import type { Page } from "playwright";
import { checkHealth, watchForRateLimitResponses } from "./detectors.js";
import { logger } from "../lib/logger.js";
import {
  attachPartialLeads,
  DEFAULT_NAV_TIMEOUT_MS,
  isAccountHealthError,
  RateLimitedError,
  TransientPageError,
  type RawLead,
  type ScrapeSource,
  type ScrapeSourceContext,
} from "./types.js";

const MAX_STAGNANT_ROUNDS = 4;
const MAX_OPEN_ATTEMPTS = 3;
const OPEN_RETRY_DELAY_MS = 4000;
// The wait for the list to draw itself gets half the page-load budget the navigation gets. They
// are sequential, and the navigation is the cheap half now that it only waits for the response.
const READY_TIMEOUT_SHARE = 0.5;
const DEFAULT_RATE_LIMIT_TOLERANCE = 3;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 20_000;
// Longest a back-off sleeps before asking the checkpoint whether the run is still wanted, so a
// cancel lands within seconds even while the run is waiting out a throttle.
const BACKOFF_SLICE_MS = 5_000;

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits out a throttle without going deaf to the user.
 *
 * A back-off runs into the tens of seconds, and sleeping through it in one call would leave a
 * cancel sitting unanswered for that whole time — so it is slept in slices with the run's
 * checkpoint consulted between them, which is what raises ScrapeCancelledError.
 */
async function backOff(ms: number, ctx: ScrapeSourceContext): Promise<void> {
  for (let remaining = ms; remaining > 0; remaining -= BACKOFF_SLICE_MS) {
    await sleep(Math.min(remaining, BACKOFF_SLICE_MS));
    if ((await ctx.checkpoint?.()) === "finish") return;
  }
}

/**
 * Re-reads the page's health after a render timeout, so a challenged session says so.
 *
 * The health check that runs when the navigation commits happens before the SPA has drawn
 * anything, so a login wall or a captcha where the list should be shows up as "the list never
 * appeared" rather than as the account signal it is — and a signal reported as a render failure is
 * one BullMQ retries against an account X has already stopped trusting.
 */
async function rethrowIfChallenged(page: Page): Promise<void> {
  try {
    await checkHealth(page);
  } catch (err) {
    if (isAccountHealthError(err)) throw err;
    // X's generic error boundary tells us nothing the timeout hadn't already.
  }
}

/**
 * Loads the list page and waits for the list itself to render, retrying what X routinely fails at.
 *
 * Loading and rendering are bounded separately because they fail for different reasons and only
 * one of them is about the page. The navigation waits for `commit` — the response headers, nothing
 * more — so it can only time out when X is genuinely unreachable from this worker; the wait for
 * the source's own selector is what decides whether the view rendered. Waiting for
 * `domcontentloaded` put a single bound across both, and X blocks DOMContentLoaded on its
 * parser-blocking bundle: a reply thread that opens fine in a browser failed three attempts running
 * with "page.goto: Timeout 30000ms exceeded", the run never getting as far as looking for a tweet.
 *
 * The first health check runs as soon as the navigation commits — before the SPA has hydrated,
 * which is precisely when "Something went wrong. Try reloading." is most likely to be on screen and
 * about to clear itself. Reloading costs one request; treating it as a rate limit checkpointed the
 * account and cost a full re-login.
 *
 * Returns "stopped" if the run was told to wrap up between attempts; a cancel raises instead.
 */
async function openListPage(source: ScrapeSource, ctx: ScrapeSourceContext): Promise<"opened" | "stopped"> {
  // Built once, outside the loop: a malformed sourceRef is a fact about the job rather than
  // something a reload fixes, and it must not be reported as a page that wouldn't render.
  const url = source.buildUrl(ctx.sourceRef);
  const navTimeoutMs = ctx.navTimeoutMs ?? DEFAULT_NAV_TIMEOUT_MS;
  const readyTimeoutMs = Math.round(navTimeoutMs * READY_TIMEOUT_SHARE);
  let lastError: unknown;
  let lastStage: "load" | "render" = "load";

  for (let attempt = 1; attempt <= MAX_OPEN_ATTEMPTS; attempt += 1) {
    let stage: "load" | "render" = "load";
    try {
      await ctx.page.goto(url, { waitUntil: "commit", timeout: navTimeoutMs });
      stage = "render";
      await checkHealth(ctx.page);
      await source.waitForReady(ctx.page, readyTimeoutMs);
      return "opened";
    } catch (err) {
      // A hard signal (login wall, captcha, real throttle) is terminal — don't burn retries on it.
      if (isAccountHealthError(err)) throw err;
      // Anything that goes wrong before the response arrives is worth another try whatever it says:
      // it never got far enough to tell us something about the page. Once loaded, only X's own
      // transient boundary and a view that didn't draw are.
      if (stage === "render" && !(err instanceof TransientPageError) && !isWaitTimeout(err)) throw err;
      if (stage === "render" && isWaitTimeout(err)) await rethrowIfChallenged(ctx.page);

      lastError = err;
      lastStage = stage;
      logger.warn(
        { err, attempt, stage, sourceRef: ctx.sourceRef },
        stage === "load"
          ? "list page did not load; retrying before treating it as a failure"
          : "list page did not render; reloading before treating it as a failure"
      );
      if (attempt < MAX_OPEN_ATTEMPTS) {
        await randomDelay(OPEN_RETRY_DELAY_MS, OPEN_RETRY_DELAY_MS * 2);
        // Three attempts at a page X isn't serving run into minutes. The run is asked between them
        // rather than only after the last, so a cancel — or the run's own clock — lands here too.
        if ((await ctx.checkpoint?.()) === "finish") return "stopped";
      }
    }
  }

  // Out of retries. Thrown as a plain Error, not an account-health error: the account is fine as far
  // as we know, so BullMQ's normal attempts/backoff should apply instead of a checkpoint.
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    lastStage === "load"
      ? `Could not reach ${url} after ${MAX_OPEN_ATTEMPTS} attempts — X did not respond in time (check the account's proxy, if it has one): ${detail}`
      : `List page never rendered after ${MAX_OPEN_ATTEMPTS} attempts: ${detail}`
  );
}

function isWaitTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

/**
 * Scrapes X's virtualized list views: read what's currently rendered, scroll, wait a random
 * interval, repeat — until the lead cap is hit or several consecutive scrolls surface nothing new.
 */
export async function scrollAndCollect(source: ScrapeSource, ctx: ScrapeSourceContext): Promise<RawLead[]> {
  const seen = ctx.into ?? new Map<string, RawLead>();
  const collected = () => Array.from(seen.values()).slice(0, ctx.capLeads);

  // HTTP 429 is the authoritative throttling signal — unambiguous, and impossible to fake from page
  // content. It is read once per round rather than latched on the first one: X's SPA fires plenty
  // of background requests that have nothing to do with this list, so one of them being throttled
  // is not the same as the session being throttled. Consecutive throttled rounds are.
  const rateLimit = watchForRateLimitResponses(ctx.page);
  const tolerance = ctx.rateLimitTolerance ?? DEFAULT_RATE_LIMIT_TOLERANCE;
  const backoffMs = ctx.rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
  let throttledRounds = 0;

  try {
    // Asked before the page is even opened, and its verdict honoured: an "engagers" job runs two
    // strategies through this function in sequence off one shared checkpoint, so a run already
    // told to wrap up — by the user or by its own clock — must not spend a page load opening the
    // second list only to break out of the loop on the next line.
    if ((await ctx.checkpoint?.()) === "finish") return collected();
    // "stopped" means the run was told to wrap up while the page was still being retried — there is
    // nothing to scroll, and nothing collected, but that is not a failure.
    if ((await openListPage(source, ctx)) === "stopped") return collected();

    let stagnantRounds = 0;
    let round = 0;

    while (seen.size < ctx.capLeads && stagnantRounds < MAX_STAGNANT_ROUNDS) {
      round += 1;
      // Checked before the round's work, not after, so a stopped run does at most one more scroll.
      // A cancel throws here and the catch below carries the collected leads out as partials; a
      // "finish" just ends the search, leaving what's collected to be enriched and saved.
      if ((await ctx.checkpoint?.()) === "finish") break;

      // Actually slow down when X asks us to, instead of walking away from the run. Only if the
      // back-off doesn't help — several rounds running — is this a throttle worth ending on.
      if (rateLimit.take() > 0) {
        throttledRounds += 1;
        if (throttledRounds >= tolerance) {
          throw new RateLimitedError(`X returned HTTP 429 on ${throttledRounds} consecutive rounds`);
        }
        const wait = backoffMs * 2 ** (throttledRounds - 1);
        logger.warn(
          { sourceRef: ctx.sourceRef, throttledRounds, waitMs: wait },
          "X returned HTTP 429; backing off before the next round"
        );
        await backOff(wait, ctx);
        continue;
      }
      throttledRounds = 0;

      try {
        await checkHealth(ctx.page);
      } catch (err) {
        if (!(err instanceof TransientPageError)) throw err;
        // Mid-scroll, don't reload: that resets to the top of the list and re-fetches everything
        // already collected. Skip this round instead and let the timeline recover on its own — if
        // it doesn't, the stagnant-round counter ends the run with the leads gathered so far.
        logger.warn({ err, sourceRef: ctx.sourceRef }, "transient error mid-scroll; skipping this round");
        stagnantRounds += 1;
        await randomDelay(ctx.minScrollDelayMs, ctx.maxScrollDelayMs);
        continue;
      }

      const items = await source.extractVisibleItems(ctx.page);
      const before = seen.size;
      for (const item of items) {
        const key = item.handle.toLowerCase();
        if (!seen.has(key)) seen.set(key, item);
      }
      stagnantRounds = seen.size === before ? stagnantRounds + 1 : 0;
      // Diagnostic only — off by default (info level in production). A clean stagnation (nothing
      // logged, run just ends 4 rounds early) is otherwise silent: neither a rate limit nor a
      // transient error, the two paths that already log, is involved. This is what distinguishes
      // "the page keeps handing back the same handful of cells" (itemsThisRound stays flat, close to
      // newThisRound) from "the page hands back plenty of cells but they're mostly ones we've already
      // seen" (itemsThisRound stays high while newThisRound drops toward 0) — two different failures
      // that look identical from the outside (leadsFound comes up short) but point at different code.
      logger.debug(
        { sourceRef: ctx.sourceRef, round, itemsThisRound: items.length, newThisRound: seen.size - before, totalSeen: seen.size, stagnantRounds },
        "scroll round complete"
      );
      ctx.onProgress?.(seen.size);

      if (seen.size >= ctx.capLeads) break;

      await ctx.page.mouse.wheel(0, 2200 + Math.random() * 800);
      await randomDelay(ctx.minScrollDelayMs, ctx.maxScrollDelayMs);
    }
  } catch (err) {
    // Carry whatever was collected before the run was cut short out to the worker, which saves it
    // rather than reporting a throttled run as `leadsFound: 0`.
    attachPartialLeads(err, collected());
    throw err;
  } finally {
    rateLimit.stop();
  }

  return collected();
}
