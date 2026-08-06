import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";
import * as relations from "./relations.js";

// pg's connection-string parser overrides an explicit `ssl` option with whatever
// sslmode it finds in the URL (e.g. sslmode=require maps to verify-full), so the
// query param has to be stripped for the explicit rejectUnauthorized override below
// to actually take effect against a self-signed cert.
const databaseUrl = new URL(env.DATABASE_URL);
databaseUrl.searchParams.delete("sslmode");

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
