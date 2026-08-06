// Same-origin relative path by default: in production this resolves through
// the Cloudflare Worker's own domain, which proxies /backend/* to the API
// server-side — the browser never talks to the backend's address directly.
// Not "/api" — Deploro's own edge reserves that prefix on *.deploro.app
// domains for its own platform API; see worker.js for the full explanation.
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? "/backend";
