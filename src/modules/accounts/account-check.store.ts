import { redisConnection } from "../../queue/connection.js";

/**
 * The transient result of a session re-check, shared between the API (which asks for one and
 * reports it) and the worker (which performs it).
 *
 * Redis rather than a column on `x_accounts` because this is inherently short-lived — the answer
 * matters for the minute the user is watching the account card and never again — and because the
 * durable half of the outcome is already recorded where it belongs: a healthy session flips
 * `status` back to `active`, and either way `activity_log` keeps the history.
 */

export type AccountSessionCheck =
  | { state: "queued"; at: string }
  | { state: "checking"; at: string }
  | { state: "healthy"; at: string }
  | { state: "unhealthy"; at: string; reason: string };

// Long enough to cover a queued check waiting behind a running scrape, short enough that a stale
// result never sits on an account card from some earlier session.
const CHECK_TTL_SECONDS = 15 * 60;

function checkKey(xAccountId: string): string {
  return `sessioncheck:xaccount:${xAccountId}`;
}

export async function setAccountSessionCheck(xAccountId: string, check: AccountSessionCheck): Promise<void> {
  await redisConnection.set(checkKey(xAccountId), JSON.stringify(check), "EX", CHECK_TTL_SECONDS);
}

export async function getAccountSessionCheck(xAccountId: string): Promise<AccountSessionCheck | null> {
  return parseCheck(await redisConnection.get(checkKey(xAccountId)));
}

/** Reads the check state for several accounts at once, for the accounts list. */
export async function getAccountSessionChecks(
  xAccountIds: string[]
): Promise<Map<string, AccountSessionCheck>> {
  const checks = new Map<string, AccountSessionCheck>();
  if (xAccountIds.length === 0) return checks;

  const raw = await redisConnection.mget(xAccountIds.map(checkKey));
  xAccountIds.forEach((id, index) => {
    const check = parseCheck(raw[index]);
    if (check) checks.set(id, check);
  });
  return checks;
}

export async function clearAccountSessionCheck(xAccountId: string): Promise<void> {
  await redisConnection.del(checkKey(xAccountId));
}

function parseCheck(raw: string | null | undefined): AccountSessionCheck | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AccountSessionCheck;
  } catch {
    // A malformed value is indistinguishable from no result, and must never break the accounts
    // list — the account's own `status` is the authoritative state either way.
    return null;
  }
}
