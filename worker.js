// Cloudflare Worker for the deployed frontend's Worker/Pages site.
//
// Static assets (the Vite build in dist/) are served automatically for
// matching paths. Anything under /backend/* falls through to this fetch
// handler, which proxies it server-side to the VPS-hosted backend — a
// Worker-to-origin fetch, not a browser request, so it isn't subject to
// mixed-content blocking. The browser only ever talks to this Worker's own
// domain; the VPS's address never appears client-side.
//
// Public prefix is /backend, not /api — Deploro's own *.deploro.app edge
// routing reserves /api on every project's custom domain for its own
// platform API and returns a 403 (error 1003) before the request ever
// reaches this Worker. The backend's own Express routes are still mounted
// at /api/*, so that prefix is restored when forwarding upstream.
const BACKEND_ORIGIN = "http://62.238.61.84:3000";
const PUBLIC_PREFIX = "/backend";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(`${PUBLIC_PREFIX}/`)) {
      const backendPath = "/api" + url.pathname.slice(PUBLIC_PREFIX.length);
      const target = new URL(backendPath + url.search, BACKEND_ORIGIN);
      return fetch(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
};
