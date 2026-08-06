// Same-origin relative path by default: in production this resolves through
// the Cloudflare Worker's own domain, which proxies /api/* to the backend
// server-side — the browser never talks to the backend's address directly.
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? "/api";
