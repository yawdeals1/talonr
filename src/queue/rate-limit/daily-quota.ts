import { redisConnection } from "../connection.js";

// Atomic incr-and-check so two concurrent workers can't both read "under limit" and overshoot.
const TRY_CONSUME_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

// ~26h TTL: buffer past the 24h window so clock skew never leaves a stale key alive into next day's checks.
const QUOTA_TTL_SECONDS = 26 * 60 * 60;

function quotaKey(xAccountId: string): string {
  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  return `quota:xaccount:${xAccountId}:${today}`;
}

export async function tryConsumeDailyQuota(xAccountId: string, dailyLimit: number): Promise<boolean> {
  const result = (await redisConnection.eval(
    TRY_CONSUME_SCRIPT,
    1,
    quotaKey(xAccountId),
    dailyLimit,
    QUOTA_TTL_SECONDS
  )) as number;
  return result === 1;
}
