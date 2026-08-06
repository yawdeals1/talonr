import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";
import * as relations from "./relations.js";

// Prefer the internal Docker-network connection string when the VPS provides one —
// it avoids a same-host NAT hairpin round trip that the public-IP variant needs.
const databaseUrl = new URL(env.DATABASE_URL_INTERNAL ?? env.DATABASE_URL);

// pg's connection-string parser overrides an explicit `ssl` option with whatever
// sslmode it finds in the URL (e.g. sslmode=require maps to verify-full), so the
// query param has to be stripped for the explicit rejectUnauthorized override below
// to actually take effect against a self-signed cert. Only force SSL back on when
// the URL asked for it — an internal connection string may not use TLS at all.
const wantsSsl = databaseUrl.searchParams.has("sslmode");
databaseUrl.searchParams.delete("sslmode");

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
