import type { NextFunction, Request, Response } from "express";
import { redisConnection } from "../queue/connection.js";
import { AppError } from "./errors.js";

// Same atomic incr-and-check pattern as queue/rate-limit/daily-quota.ts, reused here for HTTP-layer
// request throttling (auth brute-force protection, expensive-endpoint flooding). Redis-backed so it
// holds up across multiple API instances/restarts, unlike an in-memory counter.
const TRY_CONSUME_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
  return 0
end
return 1
`;

export interface RateLimitOptions {
  windowSeconds: number;
  limit: number;
  keyPrefix: string;
  /** Derives the bucket key from the request — e.g. IP for anonymous routes, user id for authed ones. */
  keyFn: (req: Request) => string;
}

export function rateLimit(options: RateLimitOptions) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = `ratelimit:${options.keyPrefix}:${options.keyFn(req)}`;
      const allowed = (await redisConnection.eval(
        TRY_CONSUME_SCRIPT,
        1,
        key,
        options.limit,
        options.windowSeconds
      )) as number;
      if (allowed !== 1) {
        next(new AppError("Too many requests, please try again later", 429));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Best-effort client IP: req.ip reflects the immediate socket peer, not header-spoofable X-Forwarded-For. */
export function byIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** Keys by the (lowercased) email in the request body — the more meaningful dimension for
 * credential-stuffing/brute-force protection on auth routes, independent of source IP. */
export function byBodyEmail(req: Request): string {
  const email = (req.body as Record<string, unknown> | undefined)?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : "unknown";
}
