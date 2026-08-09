// Same-origin relative path by default: in production this resolves through
// the Cloudflare Worker's own domain, which proxies /backend/* to the API
// server-side — the browser never talks to the backend's address directly.
// Not "/api" — Deploro's own edge reserves that prefix on *.deploro.app
// domains for its own platform API; see worker.js for the full explanation.
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? "/backend";

// Turnstile sitekeys are public by design (unlike the secret, which only ever lives server-side
// as TURNSTILE_SECRET — see auth.controller.ts). Registered for localhost/127.0.0.1/
// talonr.deploro.app; widget name "talonr-register" in the Cloudflare dashboard.
export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "0x4AAAAAAEK07r3BDXghCSWt";
