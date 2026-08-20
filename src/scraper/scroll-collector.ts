import { checkHealth, watchForRateLimitResponses } from "./detectors.js";
import { logger } from "../lib/logger.js";
import {
  attachPartialLeads,
  RateLimitedError,
  TransientPageError,
  type RawLead,
  type ScrapeSource,
  type ScrapeSourceContext,
} from "./types.js";

const MAX_STAGNANT_ROUNDS = 4;
const MAX_OPEN_ATTEMPTS = 3;
const OPEN_RETRY_DELAY_MS = 4000;
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
 * Loads the list page and waits for it to render, retrying X's transient error boundary.
 *
 * The first health check runs right after `goto` at `domcontentloaded` — before the SPA has
 * hydrated, which is precisely when "Something went wrong. Try reloading." is most likely to be on
 * screen and about to clear itself. Reloading costs one request; treating it as a rate limit
 * checkpointed the account and cost a full re-login.
 */
async function openListPage(source: ScrapeSource, ctx: ScrapeSourceContext): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_OPEN_ATTEMPTS; attempt += 1) {
    try {
      await ctx.page.goto(source.buildUrl(ctx.sourceRef), { waitUntil: "domcontentloaded" });
      await checkHealth(ctx.page);
      await source.waitForReady(ctx.page);
      return;
    } catch (err) {
      // A hard signal (login wall, captcha, real throttle) is terminal — don't burn retries on it.
      if (err instanceof RateLimitedError) throw err;
      if (!(err instanceof TransientPageError) && !isWaitTimeout(err)) throw err;

      lastError = err;
      logger.warn(
        { err, attempt, sourceRef: ctx.sourceRef },
        "list page did not render; reloading before treating it as a failure"
      );
      if (attempt < MAX_OPEN_ATTEMPTS) await randomDelay(OPEN_RETRY_DELAY_MS, OPEN_RETRY_DELAY_MS * 2);
    }
  }

  // Out of retries. Thrown as a plain Error, not an account-health error: the account is fine as far
  // as we know, so BullMQ's normal attempts/backoff should apply instead of a checkpoint.
  throw new Error(
    `List page never rendered after ${MAX_OPEN_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
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
    await ctx.checkpoint?.();
    await openListPage(source, ctx);

    let stagnantRounds = 0;

    while (seen.size < ctx.capLeads && stagnantRounds < MAX_STAGNANT_ROUNDS) {
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
