import { redisConnection } from "../connection.js";

/**
 * A temporary "X is throttling this account, back off" state — the answer to HTTP 429, in place of
 * the permanent checkpoint a 429 used to trigger.
 *
 * The distinction this module exists to draw: a captcha or a login challenge means X no longer
 * trusts the *session*, and only a human re-login can settle that. A rate limit means nothing of
 * the sort — the cookies stay valid, X is simply asking us to slow down, and the window clears on
 * its own within minutes. Treating the two the same made every throttled run cost a full
 * interactive re-login (`accounts.service.ts#updateAccount` refuses to reactivate a checkpointed
 * account), which re-proved credentials that were never in question.
 *
 * So a rate limit leaves `x_accounts.status` alone and parks the account here instead. Jobs for a
 * cooling-down account are delayed until it expires rather than failed, which makes the whole
 * thing self-healing: the user does nothing and the next run starts when X is ready.
 *
 * Redis, not the database, for the same reasons the daily quota lives here — the state is
 * inherently temporary and wants a TTL, and Postgres enums on `x_accounts.status` can't be
 * extended from this app anyway (the type is owned by a role this connection isn't a member of).
 */

// Atomic so two workers hitting 429s at once can't both count a strike and then race on the SET,
// leaving a shorter cooldown than the strike count earned.
const START_COOLDOWN_SCRIPT = `
local cooldownKey = KEYS[1]
local strikesKey = KEYS[2]
local baseSeconds = tonumber(ARGV[1])
local maxSeconds = tonumber(ARGV[2])
local strikesTtlSeconds = tonumber(ARGV[3])
local reason = ARGV[4]

local strikes = redis.call('INCR', strikesKey)
redis.call('EXPIRE', strikesKey, strikesTtlSeconds)

-- Each repeat throttle inside the strike window doubles the wait: backing off harder when X keeps
-- pushing back is the conservative reading of a repeated 429, and the cap keeps it bounded.
local seconds = baseSeconds
for _ = 2, strikes do
  if seconds >= maxSeconds then break end
  seconds = seconds * 2
end
if seconds > maxSeconds then seconds = maxSeconds end

redis.call('SET', cooldownKey, reason, 'EX', seconds)
return seconds
`;

/**
 * How long repeat throttles keep escalating. Past this with no further 429s, an account is treated
 * as freshly behaved again and the next cooldown starts back at the base duration.
 */
const STRIKES_TTL_SECONDS = 6 * 60 * 60;

function cooldownKey(xAccountId: string): string {
  return `cooldown:xaccount:${xAccountId}`;
}

function strikesKey(xAccountId: string): string {
  return `cooldown:xaccount:${xAccountId}:strikes`;
}

export interface AccountCooldown {
  /** When the account may be used again. */
  until: Date;
  /** The throttling signal that started it, for display on the account and the stopped job. */
  reason: string;
}

/**
 * Parks an account until X's throttle window has plausibly passed, and reports when that is.
 *
 * `baseMinutes`/`maxMinutes` come from config rather than being fixed here, since the right wait
 * depends on how hard the deployment is being pushed — see RATE_LIMIT_COOLDOWN_MINUTES.
 */
export async function startAccountCooldown(
  xAccountId: string,
  reason: string,
  baseMinutes: number,
  maxMinutes: number
): Promise<AccountCooldown> {
  const seconds = (await redisConnection.eval(
    START_COOLDOWN_SCRIPT,
    2,
    cooldownKey(xAccountId),
    strikesKey(xAccountId),
    baseMinutes * 60,
    maxMinutes * 60,
    STRIKES_TTL_SECONDS,
    reason
  )) as number;

  return { until: new Date(Date.now() + seconds * 1000), reason };
}

/** The account's live cooldown, or null if it is free to run. */
export async function getAccountCooldown(xAccountId: string): Promise<AccountCooldown | null> {
  const key = cooldownKey(xAccountId);
  const [reason, ttlMs] = await Promise.all([redisConnection.get(key), redisConnection.pttl(key)]);
  // -2 = no key, -1 = no expiry (shouldn't happen; every write above sets one). Either way there
  // is no meaningful "until", so don't hold the account back on it.
  if (reason === null || ttlMs < 0) return null;
  return { until: new Date(Date.now() + ttlMs), reason };
}

/** Reads the cooldown for several accounts at once, for the accounts list. */
export async function getAccountCooldowns(xAccountIds: string[]): Promise<Map<string, AccountCooldown>> {
  const cooldowns = new Map<string, AccountCooldown>();
  if (xAccountIds.length === 0) return cooldowns;

  // One round trip for the whole list rather than two per account.
  const pipeline = redisConnection.pipeline();
  for (const id of xAccountIds) {
    pipeline.get(cooldownKey(id));
    pipeline.pttl(cooldownKey(id));
  }
  const results = await pipeline.exec();
  if (!results) return cooldowns;

  xAccountIds.forEach((id, index) => {
    const reason = results[index * 2]?.[1] as string | null | undefined;
    const ttlMs = results[index * 2 + 1]?.[1] as number | undefined;
    if (typeof reason !== "string" || typeof ttlMs !== "number" || ttlMs < 0) return;
    cooldowns.set(id, { reason, until: new Date(Date.now() + ttlMs) });
  });

  return cooldowns;
}

/**
 * Ends a cooldown early. Used when a session re-check finds the account healthy — a successful
 * live request to X is better evidence than the timer that the throttle has lifted.
 */
export async function clearAccountCooldown(xAccountId: string): Promise<void> {
  await redisConnection.del(cooldownKey(xAccountId), strikesKey(xAccountId));
}
