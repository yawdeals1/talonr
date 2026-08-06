import { randomUUID } from "node:crypto";
import { redisConnection } from "../connection.js";

// Sorted-set semaphore: member = a random token per holder, score = expiry epoch-ms.
// Self-expiring so a crashed worker doesn't permanently wedge an account's concurrency slot.
const ACQUIRE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count < tonumber(ARGV[4]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
  redis.call('PEXPIRE', KEYS[1], 3600000)
  return 1
end
return 0
`;

const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
return 1
`;

const SLOT_TTL_MS = 15 * 60 * 1000; // a single scrape run should never legitimately hold a slot this long

function semaphoreKey(xAccountId: string): string {
  return `sem:xaccount:${xAccountId}`;
}

export interface AccountSlot {
  token: string;
  xAccountId: string;
}

export async function acquireAccountSlot(
  xAccountId: string,
  maxConcurrency: number
): Promise<AccountSlot | null> {
  const token = randomUUID();
  const now = Date.now();
  const expiry = now + SLOT_TTL_MS;
  const acquired = (await redisConnection.eval(
    ACQUIRE_SCRIPT,
    1,
    semaphoreKey(xAccountId),
    now,
    expiry,
    token,
    maxConcurrency
  )) as number;
  return acquired === 1 ? { token, xAccountId } : null;
}

export async function releaseAccountSlot(slot: AccountSlot): Promise<void> {
  await redisConnection.eval(RELEASE_SCRIPT, 1, semaphoreKey(slot.xAccountId), slot.token);
}
