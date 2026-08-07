import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // Internal Docker-network connection strings, when the VPS's compute stack and its
  // raw Postgres/Redis containers share a network — preferred over the public-IP
  // variants above when present, since they avoid a same-host NAT hairpin round trip.
  DATABASE_URL_INTERNAL: z.string().min(1).optional(),
  REDIS_URL_INTERNAL: z.string().min(1).optional(),
  SESSION_ENCRYPTION_KEY: z.string().min(1),
  // Deploro's platform Worker, which hosts the Auth-as-a-Service routes (/auth/:slug/*) used
  // in place of locally-signed JWTs. See src/modules/auth/deploro-auth.client.ts.
  DEPLORO_AUTH_BASE_URL: z.string().min(1),
  DEPLORO_PROJECT_SLUG: z.string().min(1).default("talonr"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  ALLOWED_ORIGIN: z.string().default("http://localhost:5173"),
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
