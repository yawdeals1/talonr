import { Redis } from "ioredis";
import { env } from "../config/env.js";

// Prefer the internal Docker-network connection string when the VPS provides one —
// it avoids a same-host NAT hairpin round trip that the public-IP variant needs.
const redisUrl = env.REDIS_URL_INTERNAL ?? env.REDIS_URL;

// BullMQ requires maxRetriesPerRequest: null on any connection it manages.
// rejectUnauthorized: false because Deploro's raw Redis serves a self-signed cert
// over rediss://; an internal plain redis:// connection string skips TLS entirely.
export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  tls: redisUrl.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
});
