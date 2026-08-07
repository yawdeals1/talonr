import { env } from "../../config/env.js";
import { AppError, ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

const BASE = env.DEPLORO_AUTH_BASE_URL;
const SLUG = env.DEPLORO_PROJECT_SLUG;
const SESSION_COOKIE_NAME = `gallium_project_session_${SLUG}`;

export interface DeploroUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  provider?: string;
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({}));
}

function errorMessage(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" ? data.error : fallback;
}

function extractSessionToken(res: Response): string {
  const cookies = res.headers.getSetCookie();
  const raw = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!raw) throw new AppError("Deploro Auth did not return a session token", 502);
  return decodeURIComponent(raw.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0]);
}

/**
 * Kicks off self-serve email+password signup. Deploro always responds
 * { ok: true } regardless of whether the email is new, pending, or already
 * confirmed (anti-enumeration by design) — the caller can't and shouldn't
 * distinguish those cases. The account can't sign in until the confirmation
 * link Deploro emails is clicked.
 */
export async function signupEmailPassword(email: string, password: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/${SLUG}/email-password/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await parseJson(res);
    throw new AppError(errorMessage(data, "Could not reach Deploro Auth"), 502);
  }
}

export async function loginEmailPassword(
  email: string,
  password: string
): Promise<{ token: string; user: DeploroUser }> {
  const res = await fetch(`${BASE}/auth/${SLUG}/email-password/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const data = await parseJson(res);
    const message = errorMessage(data, "Sign-in failed");
    if (res.status === 400) throw new UnauthorizedError(message);
    if (res.status === 403) throw new ForbiddenError(message);
    throw new AppError(message, res.status);
  }

  const token = extractSessionToken(res);
  const data = await parseJson(res);
  return { token, user: data.user as DeploroUser };
}

export async function validateSession(token: string): Promise<DeploroUser> {
  const res = await fetch(`${BASE}/auth/${SLUG}/session`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const data = await parseJson(res);
    const message = errorMessage(data, "Invalid or expired session");
    if (res.status === 401) throw new UnauthorizedError(message);
    throw new AppError(message, res.status);
  }

  const data = await parseJson(res);
  return data.user as DeploroUser;
}

/** Best-effort — invalidates the session server-side; local cookie clears regardless of outcome. */
export async function revokeSession(token: string): Promise<void> {
  try {
    await fetch(`${BASE}/auth/${SLUG}/logout`, {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
  } catch {
    // ignore — nothing actionable if Deploro Auth is unreachable at logout time
  }
}
