import { Redis } from "ioredis";
import { env } from "../config/env.js";

// BullMQ requires maxRetriesPerRequest: null on any connection it manages.
// rejectUnauthorized: false because Deploro's raw Redis serves a self-signed cert.
export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: env.REDIS_URL.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
});
