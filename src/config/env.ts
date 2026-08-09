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
  SCROLL_DELAY_MIN_MS: z.coerce.number().int().positive().default(1500),
  SCROLL_DELAY_MAX_MS: z.coerce.number().int().positive().default(4000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
