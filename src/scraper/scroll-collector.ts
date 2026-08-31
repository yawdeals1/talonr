import type { Page } from "playwright";
import { checkHealth, watchForRateLimitResponses } from "./detectors.js";
import { logger } from "../lib/logger.js";
import {
  attachPartialLeads,
  DEFAULT_NAV_TIMEOUT_MS,
  isAccountHealthError,
  RateLimitedError,
  TransientPageError,
  type CollectionResult,
  type CollectionStopReason,
  type RawLead,
  type ScrapeSource,
  type ScrapeSourceContext,
} from "./types.js";

// How many rounds in a row may surface nothing new before the run concludes the list has stopped
// producing. Higher than it looks like it needs to be on purpose: each round now waits for the
// timeline to actually change before it gives up (see waitForTimelineChange), so a stagnant round
// means "nothing arrived in twelve seconds", not "nothing arrived in the two-second nap I took".
// At four rounds with a blind nap the old loop could conclude a 64k-follower account was finished
// inside twelve seconds of a scroll that had never moved.
const MAX_STAGNANT_ROUNDS = 6;
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
// One modest viewport at a time keeps X's bottom-of-timeline loading sentinel in view long enough
// to request the next page. The old 2,200–3,000px jump could leap straight past it.
const MIN_SCROLL_DISTANCE_PX = 600;
// Longest a round waits for X to answer a scroll with more of the list before calling the round
// stagnant. X's followers endpoint routinely takes several seconds under load, and the polite
// scroll delay (1.5–4s by default) is not a bound anyone chose with a network fetch in mind.
const MAX_CONTENT_WAIT_MS = 12_000;
// How often the wait above re-reads the timeline while it is waiting.
const CONTENT_POLL_INTERVAL_MS = 400;
// How long a scroll gets to actually land before it is treated as one that didn't (see hasMoved).
const SCROLL_SETTLE_MS = 600;
const SCROLL_SETTLE_POLL_MS = 100;

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * What the timeline looks like right now — enough to tell "the page moved and grew" from "nothing
 * I did had any effect", which are the two failures a stalled scrape is made of.
 */
interface TimelineState {
  /** Scroll offset of whichever element actually scrolls this page. */
  offset: number;
  /** Full scrollable height, which grows as X appends more of the list. */
  height: number;
  /** Cells currently rendered in the primary column (X virtualizes, so this plateaus). */
  cells: number;
  /** The last rendered cell's profile path — changes as the window slides down the list. */
  lastCell: string | null;
}

const UNKNOWN_TIMELINE: TimelineState = { offset: 0, height: 0, cells: 0, lastCell: null };

/**
 * Reads the timeline's scroll position and contents from inside the page.
 *
 * Self-contained (no imports, no closures) because it is handed to `page.evaluate`. It resolves
 * the scrolling element rather than assuming the window: X scrolls the document today, but the
 * whole point of measuring is to notice when a scroll didn't land, and a measurement that reads a
 * different element from the one that moved would report exactly the false stall this is here to
 * detect.
 */
export function readTimelineState(): TimelineState {
  const column = document.querySelector('[data-testid="primaryColumn"]');

  function scroller(): Element {
    for (let node = column; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 4) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") return node;
      }
    }
    return document.scrollingElement ?? document.documentElement;
  }

  const element = scroller();
  const cells = Array.from((column ?? document).querySelectorAll('[data-testid="UserCell"]'));
  const last = cells[cells.length - 1];
  const lastLink = last ? last.querySelector("a[href^='/']") : null;

  return {
    offset: Math.round(element.scrollTop),
    height: Math.round(element.scrollHeight),
    cells: cells.length,
    lastCell: lastLink ? (lastLink as HTMLAnchorElement).getAttribute("href") : null,
  };
}

/**
 * Scrolls from inside the page, for when a dispatched wheel event doesn't land.
 *
 * Self-contained for `page.evaluate`. Scrolls the resolved scroller directly and, failing that,
 * brings the last rendered cell into view — which works whatever element owns the scroll, and is
 * the thing X's infinite-scroll sentinel is actually watching for.
 */
export function forceTimelineScroll(distance: number): void {
  const column = document.querySelector('[data-testid="primaryColumn"]');

  let element: Element | null = null;
  for (let node = column; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 4) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        element = node;
        break;
      }
    }
  }
  element = element ?? document.scrollingElement ?? document.documentElement;

  const before = element.scrollTop;
  element.scrollTop = before + distance;

  if (element.scrollTop === before) {
    const cells = (column ?? document).querySelectorAll('[data-testid="UserCell"]');
    const last = cells[cells.length - 1];
    if (last) last.scrollIntoView({ block: "end" });
  }
}

async function readTimeline(page: Page): Promise<TimelineState> {
  try {
    return await page.evaluate(readTimelineState);
  } catch {
    // The page navigated out from under the evaluate. Not knowing where we are is not evidence of
    // anything — report an unknown state and let the round's own extraction decide.
    return UNKNOWN_TIMELINE;
  }
}

/**
 * Advances X's virtualized primary timeline, escalating until the page actually moves.
 *
 * Playwright's mouse begins at (0, 0), which is inside X's fixed navigation/header rather than the
 * primary column. A wheel event is dispatched to the element under the pointer, so leaving it there
 * made the initial SPA-prefetched follower batches appear (40, then 21 in a live failed run) but
 * never advanced the list after that. Moving into the primary column first fixes that case — but
 * only that case, and a wheel event is a request, not a guarantee: if it doesn't land there is
 * nothing in a fire-and-forget scroll to say so, and the run reads the same viewport over and over
 * until the stagnation counter ends it with a green tick and no explanation. So the position is
 * measured on both sides and the scroll escalates through in-page fallbacks until it moves.
 *
 * Returns whether the timeline actually moved, which is what separates "the list ended" from
 * "we never got any further".
 */
async function advanceTimeline(page: Page, before: TimelineState, stagnantRounds: number): Promise<boolean> {
  const viewport = page.viewportSize();
  const viewportHeight = viewport?.height ?? 800;
  // A round that already found nothing reaches further: X sometimes needs the sentinel crossed
  // more decisively than one polite viewport does.
  const reach = 1 + Math.min(stagnantRounds, 3);
  const distance = Math.max(MIN_SCROLL_DISTANCE_PX, viewportHeight * (0.8 + Math.random() * 0.2)) * reach;

  const box = await page
    .locator('[data-testid="primaryColumn"]')
    .first()
    .boundingBox()
    .catch(() => null);
  const maxX = Math.max(1, (viewport?.width ?? 1280) - 1);
  // Falling back to the middle of the viewport rather than leaving the pointer wherever it was:
  // (0, 0) is X's fixed header, which is exactly the position this function exists to move off.
  const x = box
    ? Math.min(maxX, Math.max(1, box.x + box.width / 2))
    : Math.round(maxX / 2);
  const y = Math.max(1, Math.round(viewportHeight / 2));
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, distance);

  if (await hasMoved(page, before)) return true;

  // The wheel didn't land. Scroll the element itself from inside the page.
  await page.evaluate(forceTimelineScroll, distance).catch(() => undefined);
  if (await hasMoved(page, before)) return true;

  // Last resort: the keyboard, which goes through the page's own focus/scroll handling rather than
  // through a synthesized pointer.
  await page.keyboard.press("End").catch(() => undefined);
  return hasMoved(page, before);
}

/**
 * Whether the timeline has moved since `before`, giving a scroll a moment to actually land.
 *
 * Playwright resolves `mouse.wheel` once the event is dispatched, not once the scrolling it causes
 * has finished — and X animates it. Reading the position the instant the call returns would
 * therefore report "didn't move" for a scroll that was mid-flight, and each escalation step below
 * would fire on top of a scroll that was already working, jumping several viewports at once and
 * skipping the very cells the run is trying to read. The first read is immediate, so a scroll that
 * has already landed costs nothing; only an apparent stall pays for the wait.
 */
async function hasMoved(page: Page, before: TimelineState): Promise<boolean> {
  const deadline = Date.now() + SCROLL_SETTLE_MS;
  for (;;) {
    const now = await readTimeline(page);
    if (now.offset !== before.offset || now.height !== before.height) return true;
    if (Date.now() >= deadline) return false;
    await sleep(SCROLL_SETTLE_POLL_MS);
  }
}

/**
 * Waits for the timeline to answer a scroll with more of the list, then takes the polite delay.
 *
 * The loop used to sleep a fixed 1.5–4s between rounds and extract whatever happened to be there.
 * That interval was chosen as scrape politeness, not as a bound on a network fetch, and X's
 * followers endpoint regularly takes longer than it — so a round could be counted stagnant purely
 * because the next page of the list was still in flight, four of those in a row could end the run,
 * and the whole thing took twelve seconds and reported success.
 *
 * Returns whether anything new rendered. The polite delay is taken either way: this waits *for*
 * X, it never scrapes faster than the configured pace.
 */
async function waitForTimelineChange(page: Page, before: TimelineState, ctx: ScrapeSourceContext): Promise<boolean> {
  const politeDelay = randomDelay(ctx.minScrollDelayMs, ctx.maxScrollDelayMs);
  const deadline = Date.now() + (ctx.contentWaitMs ?? MAX_CONTENT_WAIT_MS);
  let changed = false;

  while (Date.now() < deadline) {
    const now = await readTimeline(page);
    if (now.cells !== before.cells || now.lastCell !== before.lastCell || now.height !== before.height) {
      changed = true;
      break;
    }
    await sleep(CONTENT_POLL_INTERVAL_MS);
  }

  await politeDelay;
  return changed;
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
 * Scrapes X's virtualized list views: read what's currently rendered, scroll, wait for X to answer,
 * repeat — until the lead cap is hit, the list stops producing, or the run is told to stop.
 *
 * Reports *why* it stopped as well as what it found. The two are equally important to the job that
 * called it: a run that ended on its cap has nothing to explain, and every other ending does.
 */
export async function scrollAndCollect(source: ScrapeSource, ctx: ScrapeSourceContext): Promise<CollectionResult> {
  const seen = ctx.into ?? new Map<string, RawLead>();
  const skipHandles = ctx.skipHandles ?? new Set<string>();
  // Handles this run passed over because an earlier run already has them. Tracked rather than
  // merely ignored so scrolling through a thousand known followers still reads as progress — a
  // continued scrape spends its first rounds doing exactly that, and counting those rounds
  // stagnant would end it before it ever reached a new account.
  const skipped = new Set<string>();
  const collected = () => Array.from(seen.values()).slice(0, ctx.capLeads);

  let rounds = 0;
  let reason: CollectionStopReason = "stopped";
  const result = (): CollectionResult => ({ leads: collected(), reason, rounds, skipped: skipped.size });

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
    if ((await ctx.checkpoint?.()) === "finish") return result();
    // "stopped" means the run was told to wrap up while the page was still being retried — there is
    // nothing to scroll, and nothing collected, but that is not a failure.
    if ((await openListPage(source, ctx)) === "stopped") return result();

    let stagnantRounds = 0;
    // Whether the page is still physically moving under us. A list that stops producing while the
    // scroll still advances is X declining to serve more; one that stops producing because there
    // is nowhere left to scroll is simply the end of the list. Same symptom, different answer, and
    // the job is entitled to be told which it was.
    let movedRecently = true;

    while (seen.size < ctx.capLeads && stagnantRounds < MAX_STAGNANT_ROUNDS) {
      rounds += 1;
      // Checked before the round's work, not after, so a stopped run does at most one more scroll.
      // A cancel throws here and the catch below carries the collected leads out as partials; a
      // "finish" just ends the search, leaving what's collected to be enriched and saved.
      if ((await ctx.checkpoint?.()) === "finish") {
        reason = "stopped";
        return result();
      }

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
      const skippedBefore = skipped.size;
      for (const item of items) {
        const key = item.handle.toLowerCase();
        // Already collected by the run this one continues: recognised, not re-collected, and not
        // charged to this run's cap — "continue" has to mean another capLeads *new* accounts.
        if (skipHandles.has(key)) {
          skipped.add(key);
          continue;
        }
        if (!seen.has(key)) seen.set(key, item);
      }
      const advanced = seen.size !== before || skipped.size !== skippedBefore;
      stagnantRounds = advanced ? 0 : stagnantRounds + 1;
      logger.debug(
        {
          sourceRef: ctx.sourceRef,
          round: rounds,
          itemsThisRound: items.length,
          newThisRound: seen.size - before,
          skippedThisRound: skipped.size - skippedBefore,
          totalSeen: seen.size,
          stagnantRounds,
        },
        "scroll round complete"
      );
      ctx.onProgress?.(seen.size);

      if (seen.size >= ctx.capLeads) break;

      const timeline = await readTimeline(ctx.page);
      movedRecently = await advanceTimeline(ctx.page, timeline, stagnantRounds);
      const grew = await waitForTimelineChange(ctx.page, timeline, ctx);

      if (!movedRecently && !grew) {
        // Nothing we can do to this page produces anything further: not a stall, the end of the
        // list. Counting it as several more stagnant rounds would only waste the run's clock
        // re-reading a viewport that is never going to change.
        logger.debug({ sourceRef: ctx.sourceRef, round: rounds, totalSeen: seen.size }, "timeline will not advance");
        stagnantRounds = MAX_STAGNANT_ROUNDS;
      }
    }

    reason =
      seen.size >= ctx.capLeads
        ? "cap"
        : movedRecently
          ? "stalled"
          : "exhausted";
  } catch (err) {
    // Carry whatever was collected before the run was cut short out to the worker, which saves it
    // rather than reporting a throttled run as `leadsFound: 0`.
    attachPartialLeads(err, collected());
    throw err;
  } finally {
    rateLimit.stop();
  }

  return result();
}
