import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

// Scoped, short-lived credential that lets scripts/login.ts write back a captured X session
// without ever holding the operator's Studio DB token or SESSION_ENCRYPTION_KEY. That script runs
// on whatever machine the account owner is on — not necessarily a checkout of this repo, and
// never with server secrets — so it can't authenticate the normal Deploro-session way. Signed with
// a key derived from SESSION_ENCRYPTION_KEY (domain-separated, not reused directly across AES-GCM
// and HMAC) so no extra secret needs provisioning.
const TOKEN_VERSION = "ct1";
const TOKEN_TTL_MS = 15 * 60 * 1000;

interface ConnectTokenPayload {
  userId: string;
  accountId: string;
  exp: number;
}

export interface ConnectToken {
  token: string;
  expiresAt: string;
}

function hmacKey(): Buffer {
  return createHash("sha256")
    .update(Buffer.from(env.SESSION_ENCRYPTION_KEY, "base64"))
    .update("talonr-connect-token-v1")
    .digest();
}

function sign(data: string): string {
  return createHmac("sha256", hmacKey()).update(data).digest("base64url");
}

export function issueConnectToken(userId: string, accountId: string): ConnectToken {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload: ConnectTokenPayload = { userId, accountId, exp };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${TOKEN_VERSION}.${encodedPayload}.${sign(encodedPayload)}`;
  return { token, expiresAt: new Date(exp).toISOString() };
}

/** Returns the {userId, accountId} the server itself issued this token for, or null if it's missing, forged, or expired. */
export function verifyConnectToken(token: string): { userId: string; accountId: string } | null {
  const [version, encodedPayload, signature] = token.split(".");
  if (version !== TOKEN_VERSION || !encodedPayload || !signature) return null;

  const expected = Buffer.from(sign(encodedPayload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let payload: ConnectTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  if (typeof payload.userId !== "string" || typeof payload.accountId !== "string") return null;
  return { userId: payload.userId, accountId: payload.accountId };
}
