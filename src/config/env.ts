import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  REDIS_URL: z.string().min(1),
  // Internal Docker-network connection string, when the VPS's compute stack and its raw
  // Redis container share a network — preferred over the public-IP variant above when
  // present, since it avoids a same-host NAT hairpin round trip.
  REDIS_URL_INTERNAL: z.string().min(1).optional(),
  SESSION_ENCRYPTION_KEY: z.string().min(1),
  // Cloudflare Turnstile secret for the "talonr-register" widget — verified server-side in
  // auth.controller.ts#register before a signup ever reaches Deploro. See src/lib/turnstile.ts.
  TURNSTILE_SECRET: z.string().min(1),
  // Deploro's platform Worker, which hosts the Auth-as-a-Service routes (/auth/:slug/*) used
  // in place of locally-signed JWTs. See src/modules/auth/deploro-auth.client.ts.
  DEPLORO_AUTH_BASE_URL: z.string().min(1),
  DEPLORO_PROJECT_SLUG: z.string().min(1).default("talonr"),
  // Deploro's Studio DB REST API — {DEPLORO_AUTH_BASE_URL}/api/projects/{id}/studio — used in
  // place of a direct Postgres connection. See src/db/studio-client.ts.
  DEPLORO_STUDIO_API_URL: z.string().min(1),
  DEPLORO_STUDIO_API_TOKEN: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  // Matches frontend/vite.config.ts's dev server port. Cookie-based auth (see auth.controller.ts)
  // needs this to actually match the frontend's origin for local dev's cross-origin
  // (different port, same "localhost" site) credentialed requests to work.
  ALLOWED_ORIGIN: z.string().default("http://localhost:5199"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  DEFAULT_DAILY_SCRAPE_LIMIT: z.coerce.number().int().positive().default(150),
  DEFAULT_MAX_CONCURRENCY_PER_ACCOUNT: z.coerce.number().int().positive().default(1),
  SCRAPE_CAP_LEADS_DEFAULT: z.coerce.number().int().positive().default(150),
  // How many candidate profiles a scrape carrying a follower/location filter may visit per lead it
  // was asked for, so it can keep looking until it has that many *matching* leads instead of
  // filtering the first N accounts in the list down to a handful. Raising it finds more matches in
  // one run at the cost of proportionally more requests to X — see scrape.worker.ts#candidateCapFor.
  SCRAPE_FILTER_CANDIDATE_MULTIPLIER: z.coerce.number().int().min(1).max(20).default(5),
  // How a rate limit is answered. A 429 parks the account in a temporary cooldown
  // (queue/rate-limit/account-cooldown.ts) instead of checkpointing it, so jobs wait the window out
  // and resume on their own — X's throttling says nothing about whether the session is still valid,
  // and a checkpoint can only be cleared by a full interactive re-login.
  RATE_LIMIT_COOLDOWN_MINUTES: z.coerce.number().int().positive().default(15),
  // Repeat throttles inside the strike window double the wait, up to this ceiling.
  RATE_LIMIT_COOLDOWN_MAX_MINUTES: z.coerce.number().int().positive().default(120),
  // How many consecutive throttled rounds/profiles a run tolerates — backing off between each —
  // before it gives up and starts a cooldown. X's SPA fires plenty of background requests, so a
  // single stray 429 is not evidence the account is being throttled; several in a row is.
  RATE_LIMIT_TOLERANCE: z.coerce.number().int().min(1).max(10).default(3),
  // First back-off after a throttled round, doubled for each consecutive one.
  RATE_LIMIT_BACKOFF_MS: z.coerce.number().int().positive().default(20_000),
  SCROLL_DELAY_MIN_MS: z.coerce.number().int().positive().default(1500),
  SCROLL_DELAY_MAX_MS: z.coerce.number().int().positive().default(4000),
  // Profile visits provide follower count/location/bio after list collection. Kept separate from
  // scroll timing because each visit is a heavier X request and should remain deliberately slow.
  PROFILE_DELAY_MIN_MS: z.coerce.number().int().positive().default(2500),
  PROFILE_DELAY_MAX_MS: z.coerce.number().int().positive().default(6000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
