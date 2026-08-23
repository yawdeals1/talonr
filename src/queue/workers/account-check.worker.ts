import { Worker } from "bullmq";
import { env } from "../../config/env.js";
import { studioGet, studioUpdate } from "../../db/studio-client.js";
import type { XAccount } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import { logActivity } from "../../modules/activity/activity.service.js";
import { setAccountSessionCheck } from "../../modules/accounts/account-check.store.js";
import { closeScrapeSession, launchScrapeSession } from "../../scraper/browser.js";
import { checkHealth } from "../../scraper/detectors.js";
import { decryptProxy, decryptSession } from "../../scraper/session-store.js";
import { TransientPageError } from "../../scraper/types.js";
import { redisConnection } from "../connection.js";
import { ACCOUNT_CHECK_QUEUE_NAME, type AccountCheckJobData } from "../queues.js";
import { clearAccountCooldown } from "../rate-limit/account-cooldown.js";

/**
 * Answers "is this account's saved X session still good?" without a human re-login.
 *
 * A checkpoint is deliberately terminal — `accounts.service.ts#updateAccount` will not flip an
 * account back to `active`, so that a trip can't be silently waved away. This worker is not a way
 * around that check; it is the check, performed automatically. Re-running the login script proves
 * the session works by watching a person use it, and this proves the same thing by making one real
 * authenticated request to X with the cookies already on file. When that request comes back as a
 * signed-in home timeline, there is nothing left for the 45-minute re-login to establish.
 *
 * When it doesn't, the account stays exactly as it was and the user is told to reconnect — the
 * failure path never weakens anything.
 */

/** Rendered only for a signed-in session; its absence is how a silently logged-out session shows up. */
const SIGNED_IN_SELECTOR = '[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Home_Link"]';

const SIGNED_IN_TIMEOUT_MS = 15_000;

interface CheckOutcome {
  healthy: boolean;
  reason: string;
}

async function runSessionCheck(account: XAccount): Promise<CheckOutcome> {
  if (!account.encryptedSession) {
    return { healthy: false, reason: "No saved session — connect this account first." };
  }

  const storageState = decryptSession(account.encryptedSession) as Parameters<typeof launchScrapeSession>[0];
  const proxy = account.encryptedProxy ? decryptProxy(account.encryptedProxy) : null;
  const session = await launchScrapeSession(storageState, proxy);

  try {
    const page = await session.context.newPage();
    // `commit` rather than `domcontentloaded`, matching the scraper: X blocks DOMContentLoaded on
    // its own bundle, and a check that times out there reports an expired session for a page that
    // was merely slow. The signed-in selector below is the real verdict either way.
    try {
      await page.goto("https://x.com/home", { waitUntil: "commit", timeout: env.SCRAPE_NAV_TIMEOUT_MS });
    } catch (err) {
      // Never reaching X says nothing about the session, so it must not be reported as an expired
      // one — the user would reconnect an account that was fine.
      if (err instanceof Error && err.name === "TimeoutError") {
        return { healthy: false, reason: "X didn't respond in time, so the session couldn't be verified. Try again." };
      }
      throw err;
    }

    // The same detector the scraper trusts: a redirect to login, a captcha frame, or X's own
    // throttling wording. Anything it raises means the session is not usable right now.
    await checkHealth(page);

    // checkHealth passing only says X didn't challenge us. A session whose cookies have quietly
    // expired can still render a logged-out home page without any of those signals, so confirm
    // something only a signed-in session draws.
    await page.waitForSelector(SIGNED_IN_SELECTOR, { timeout: SIGNED_IN_TIMEOUT_MS });

    return { healthy: true, reason: "X loaded a signed-in session for this account." };
  } finally {
    await closeScrapeSession(session);
  }
}

function describeFailure(err: unknown): string {
  if (err instanceof TransientPageError) {
    return "X's page didn't load properly, so the session couldn't be verified. Try the check again.";
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return "X never rendered a signed-in view — this session has most likely expired. Reconnect the account.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function startAccountCheckWorker(): Worker<AccountCheckJobData> {
  const worker = new Worker<AccountCheckJobData>(
    ACCOUNT_CHECK_QUEUE_NAME,
    async (job) => {
      const { userId, xAccountId } = job.data;

      const account = await studioGet<XAccount>("x_accounts", xAccountId);
      // Ownership was verified when the check was requested; re-checked here because the row can
      // change (or vanish) between the request and this job running.
      if (!account || account.userId !== userId) {
        logger.info({ xAccountId }, "skipping session check: the account no longer exists");
        return;
      }

      await setAccountSessionCheck(xAccountId, { state: "checking", at: new Date().toISOString() });

      let outcome: CheckOutcome;
      try {
        outcome = await runSessionCheck(account);
      } catch (err) {
        logger.warn({ err, xAccountId }, "session check could not confirm the account");
        outcome = { healthy: false, reason: describeFailure(err) };
      }

      if (!outcome.healthy) {
        // Deliberately leaves `status` untouched: a check that couldn't confirm the session must
        // never be the thing that changes an account's state.
        await setAccountSessionCheck(xAccountId, {
          state: "unhealthy",
          at: new Date().toISOString(),
          reason: outcome.reason,
        });
        await logActivity(userId, "account.check_failed", { xAccountId, reason: outcome.reason });
        return;
      }

      await studioUpdate<XAccount>("x_accounts", xAccountId, { status: "active", lastUsedAt: new Date() });
      // A live signed-in request is better evidence than the cooldown timer that X has let go.
      await clearAccountCooldown(xAccountId);
      await setAccountSessionCheck(xAccountId, { state: "healthy", at: new Date().toISOString() });
      await logActivity(userId, "account.revalidated", { xAccountId, previousStatus: account.status });
      logger.info({ xAccountId }, "session re-check succeeded; account reactivated");
    },
    // One at a time: a session check launches its own Chromium, and these are user-triggered
    // one-offs rather than throughput work.
    { connection: redisConnection, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "account session check failed");
  });

  return worker;
}
