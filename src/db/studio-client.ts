import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";

const BASE = env.DEPLORO_STUDIO_API_URL;
const TOKEN = env.DEPLORO_STUDIO_API_TOKEN;

interface StudioSpec {
  components?: {
    schemas?: Record<string, { properties?: Record<string, unknown> }>;
  };
}

let specCache: { value: StudioSpec; expiresAt: number } | null = null;
let specRequest: Promise<StudioSpec> | null = null;

type FilterValue = string | number | boolean;

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({}));
}

function errorMessage(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" ? data.error : fallback;
}

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function camelCase(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * The Studio API speaks raw Postgres rows (snake_case columns, no ORM mapping). Every caller in
 * this codebase otherwise deals exclusively in camelCase (matching the field names Drizzle used to
 * infer) — these convert at the client boundary so the service layer never has to know the
 * difference. Shallow only: none of Talonr's tables nest objects except jsonb columns
 * (filter_definition, metadata), which are opaque JSON blobs, not further key-mapped.
 */
function toSnakeCaseKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) out[snakeCase(key)] = value;
  return out;
}

function toCamelCaseKeys<T>(obj: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) out[camelCase(key)] = value;
  return out as T;
}

/** jsonb columns need a JSON string, not a raw object — pg doesn't auto-serialize parameterized values. */
function serializeValues(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value instanceof Date) out[key] = value.toISOString();
    else if (value !== null && typeof value === "object") out[key] = JSON.stringify(value);
    else out[key] = value;
  }
  return out;
}

async function studioSpec(): Promise<StudioSpec> {
  const now = Date.now();
  if (specCache && specCache.expiresAt > now) return specCache.value;

  if (!specRequest) {
    specRequest = (async () => {
      const res = await fetch(`${BASE}/spec`, { headers: authHeaders() });
      if (!res.ok) {
        const data = await parseJson(res);
        throw new AppError(errorMessage(data, "Studio schema lookup failed"), res.status);
      }
      const value = (await res.json()) as StudioSpec;
      specCache = { value, expiresAt: Date.now() + 60_000 };
      return value;
    })().finally(() => {
      specRequest = null;
    });
  }

  return specRequest;
}

/**
 * Studio generates an OpenAPI schema from the live database. Checking it before using a recently
 * added optional column lets rolling deployments remain compatible while the matching database
 * migration is being applied. The short cache avoids putting a schema request on every insert.
 */
export async function studioTableHasColumn(table: string, column: string): Promise<boolean> {
  const spec = await studioSpec();
  return Object.prototype.hasOwnProperty.call(spec.components?.schemas?.[table]?.properties ?? {}, column);
}

export async function studioList<T>(
  table: string,
  options: { filter?: Record<string, FilterValue>; limit?: number; offset?: number } = {}
): Promise<{ rows: T[]; total: number }> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  for (const [key, value] of Object.entries(options.filter ?? {})) {
    params.set(`filter[${snakeCase(key)}]`, String(value));
  }

  const res = await fetch(`${BASE}/${table}?${params.toString()}`, { headers: authHeaders() });
  if (!res.ok) {
    const data = await parseJson(res);
    throw new AppError(errorMessage(data, `Studio list failed for ${table}`), res.status);
  }
  const data = await parseJson(res);
  const rows = (data.rows as Record<string, unknown>[]).map((r) => toCamelCaseKeys<T>(r));
  return { rows, total: data.total as number };
}

/**
 * The Studio API's list endpoint has no ORDER BY support at all — every list in this codebase that
 * relied on Drizzle's `orderBy` needs to sort client-side instead. Pages through `studioList`
 * (1000 rows at a time) up to `cap`, then sorts the accumulated set. Used for every table, not just
 * the ones needing in-process range/keyword filtering — plain equality-filtered lists need this too.
 */
export async function studioListSorted<T>(
  table: string,
  options: { filter?: Record<string, FilterValue>; cap?: number },
  compareFn: (a: T, b: T) => number
): Promise<T[]> {
  const cap = options.cap ?? 2000;
  const pageSize = 1000;
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const { rows, total } = await studioList<T>(table, { filter: options.filter, limit: pageSize, offset });
    all.push(...rows);
    offset += rows.length;
    if (rows.length === 0 || offset >= total || all.length >= cap) break;
  }
  return all.slice(0, cap).sort(compareFn);
}

export async function studioGet<T>(table: string, id: string): Promise<T | null> {
  const res = await fetch(`${BASE}/${table}/${id}`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) {
    const data = await parseJson(res);
    throw new AppError(errorMessage(data, `Studio get failed for ${table}`), res.status);
  }
  const data = await parseJson(res);
  return toCamelCaseKeys<T>(data.row as Record<string, unknown>);
}

export async function studioInsert<T>(table: string, values: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/${table}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(serializeValues(toSnakeCaseKeys(values))),
  });
  if (!res.ok) {
    const data = await parseJson(res);
    throw new AppError(errorMessage(data, `Studio insert failed for ${table}`), res.status);
  }
  const data = await parseJson(res);
  return toCamelCaseKeys<T>(data.row as Record<string, unknown>);
}

export async function studioUpdate<T>(table: string, id: string, values: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/${table}/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(serializeValues(toSnakeCaseKeys(values))),
  });
  if (!res.ok) {
    const data = await parseJson(res);
    throw new AppError(errorMessage(data, `Studio update failed for ${table}`), res.status);
  }
  const data = await parseJson(res);
  return toCamelCaseKeys<T>(data.row as Record<string, unknown>);
}

export async function studioDelete(table: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/${table}/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok && res.status !== 404) {
    const data = await parseJson(res);
    throw new AppError(errorMessage(data, `Studio delete failed for ${table}`), res.status);
  }
}
