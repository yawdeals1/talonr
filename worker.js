// Cloudflare Worker for the deployed frontend's Worker/Pages site.
//
// Static assets (the Vite build in dist/) are served automatically for
// matching paths. Anything under /backend/* falls through to this fetch
// handler, which proxies it server-side to the VPS-hosted backend — a
// Worker-to-origin fetch, not a browser request, so it isn't subject to
// mixed-content blocking. The browser only ever talks to this Worker's own
// domain; the VPS's address never appears client-side.
//
// Two platform quirks this works around, confirmed empirically:
//   1. Deploro's own *.deploro.app edge reserves /api on every project's
//      custom domain for its own platform API and 403s (Cloudflare error
//      1003) before the request reaches this Worker — hence /backend as the
//      public prefix, with /api restored when forwarding upstream (the
//      backend's own Express routes are still mounted at /api/*).
//   2. Cloudflare Workers' fetch() blocks outbound requests to raw IP
//      literals (also surfaces as error 1003) but allows real hostnames,
//      HTTP or HTTPS. 62-238-61-84.nip.io is nip.io's wildcard-DNS service —
//      it publicly resolves to 62.238.61.84 with no domain purchase or setup
//      needed, satisfying that requirement for the exact same VPS IP.
const BACKEND_ORIGIN = "http://62-238-61-84.nip.io:3000";
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
