// Cloudflare Worker for the deployed frontend's Worker/Pages site.
//
// Static assets (the Vite build in dist/) are served automatically for
// matching paths. Anything under /api/* falls through to this fetch handler,
// which proxies it server-side to the VPS-hosted backend — a Worker-to-origin
// fetch, not a browser request, so it isn't subject to mixed-content blocking.
// The browser only ever talks to this Worker's own domain; the VPS's address
// never appears client-side.
const BACKEND_ORIGIN = "http://62.238.61.84:3000";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const target = new URL(url.pathname + url.search, BACKEND_ORIGIN);
      return fetch(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
};
