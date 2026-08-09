import exactDomains from "disposable-email-domains/index.js";
import wildcardDomains from "disposable-email-domains/wildcard.js";

// index.js is exact-match domains; wildcard.js is suffixes that also block subdomains
// (e.g. "mailinator.com" in wildcard blocks "foo.mailinator.com" too).
const blockedExact = new Set(exactDomains.map((domain) => domain.toLowerCase()));
const blockedSuffixes = wildcardDomains.map((domain) => domain.toLowerCase());

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop();
  if (!domain) return false;

  if (blockedExact.has(domain)) return true;
  return blockedSuffixes.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
}
