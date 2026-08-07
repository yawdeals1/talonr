import { API_BASE_URL } from "../lib/config";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  // Loosely typed on purpose: named filter interfaces (no index signature) aren't
  // structurally assignable to Record<string, ...>, so this accepts any plain object
  // and stringifies primitive values found on it at runtime.
  query?: object;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  // Base is required for relative API_BASE_URL values (e.g. "/backend" in
  // production) — new URL() throws on a relative string with no base.
  // Absolute API_BASE_URL values (local dev overrides) are unaffected by it.
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

// Same resolution as apiFetch, exposed for the rare case something outside apiFetch needs the
// fully-qualified URL — e.g. embedding a copy-pasteable command for a script that runs outside the
// browser (scripts/login.ts) and so can't rely on relative paths or credentials: "include".
export function absoluteApiUrl(path: string): string {
  return buildUrl(path);
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers,
    // Auth lives in the httpOnly talonr_token cookie the API sets on login — never in JS-readable
    // storage. "include" is required for the cross-origin case (local dev: Vite's dev server on a
    // different port than the API); same-origin in production (the Worker proxies /backend
    // same-origin), where it's a no-op.
    credentials: "include",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}
