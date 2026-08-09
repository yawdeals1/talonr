import { env } from "../config/env.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

/** Canonical server-side Turnstile verification — never trust a token without this round trip. */
export async function verifyTurnstileToken(token: string, remoteIp: string): Promise<boolean> {
  const res = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: remoteIp }),
  });
  const result = (await res.json()) as SiteverifyResponse;
  return result.success;
}
