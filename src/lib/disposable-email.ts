import exactDomains from "disposable-email-domains/index.js";
import wildcardDomains from "disposable-email-domains/wildcard.js";
import { logger } from "./logger.js";

// The bundled npm package is only the offline/cold-start fallback — disposable-mail services
// (10minutemail.net, guerrillamail, etc.) rotate through freshly-registered front-end domains
// faster than any package version pinned in package.json tracks. disposable-email-domains/
// disposable-email-domains on GitHub is the canonical, actively-maintained community blocklist
// (the same one PyPI, npm's own registry, and most other "block disposable email" integrations
// pull from) — fetched live so newly-added domains show up without a redeploy.
const REMOTE_BLOCKLIST_URL =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const REMOTE_FETCH_TIMEOUT_MS = 5000;
export const REMOTE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const blockedDomains = new Set<string>([
  ...exactDomains.map((domain) => domain.toLowerCase()),
  ...wildcardDomains.map((domain) => domain.toLowerCase()),
]);

export function mergeBlocklistText(text: string): void {
  for (const rawLine of text.split("\n")) {
    const domain = rawLine.trim().toLowerCase();
    if (!domain || domain.startsWith("#")) continue;
    blockedDomains.add(domain);
  }
}

/**
 * One-shot best-effort refresh from the remote blocklist — never throws, just logs and leaves
 * the existing (bundled-package-seeded, possibly previously-fetched) list in place on failure or
 * timeout. Pure I/O with no side effects on scheduling; call sites (server.ts) own the timer.
 */
export async function refreshDisposableEmailBlocklist(): Promise<void> {
  try {
    const res = await fetch(REMOTE_BLOCKLIST_URL, { signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`disposable-email blocklist fetch failed: ${res.status}`);
    mergeBlocklistText(await res.text());
    logger.info({ domains: blockedDomains.size }, "disposable-email blocklist refreshed");
  } catch (err) {
    logger.warn({ err }, "disposable-email blocklist refresh failed, using existing list");
  }
}

/**
 * Starts the periodic background refresh (see server.ts) — only called from a running server
 * process, never from tests, so `isDisposableEmail` stays pure/offline-safe (no network I/O) for
 * every caller that doesn't explicitly opt into this. `.unref()`'d so a scheduled-but-pending
 * refresh never keeps the process alive on its own.
 */
export function startDisposableEmailBlocklistRefresh(): void {
  setInterval(() => {
    void refreshDisposableEmailBlocklist();
  }, REMOTE_REFRESH_INTERVAL_MS).unref();
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop();
  if (!domain) return false;

  // Walk from the full domain up to its second-level domain, per the blocklist's own matching
  // recommendation — catches both exact matches and subdomains of a listed domain
  // (e.g. "foo.mailinator.com" is blocked by a "mailinator.com" listing).
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (blockedDomains.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
