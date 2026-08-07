// Cloudflare Worker for the deployed frontend's Worker/Pages site.
//
// Static assets (the Vite build in dist/) are served automatically for
// matching paths. Anything under /backend/* falls through to this fetch
// handler, which proxies it server-side to the VPS-hosted backend — a
// Worker-to-origin fetch, not a browser request, so it isn't subject to
// mixed-content blocking. The browser only ever talks to this Worker's own
// domain; the VPS's address never appears client-side.
//
// The VPS host lives in a Worker secret (VPS_HOST — set via
// `deploro hosting set-env`), not hardcoded here, so a VPS migration is a
// config update through the platform rather than a source edit.
//
// Platform quirks this works around, confirmed empirically:
//   1. Deploro's own *.deploro.app edge reserves /api on every project's
//      custom domain for its own platform API and 403s (Cloudflare error
//      1003) before the request reaches this Worker — hence /backend as the
//      public prefix, with /api restored when forwarding upstream (the
//      backend's own Express routes are still mounted at /api/*).
//   2. Cloudflare Workers' fetch() blocks outbound requests to raw IP
//      literals (also surfaces as error 1003) but allows real hostnames,
//      HTTP or HTTPS — hence the nip.io wildcard-DNS wrapping below, which
//      publicly resolves `a-b-c-d.nip.io` to `a.b.c.d` with no domain
//      purchase or setup needed, satisfying that requirement for whatever
//      VPS_HOST currently is.
//
// The VPS's own docker-compose (see docker-compose.yml + Caddyfile) runs a
// Caddy reverse proxy in front of the api container that automatically
// obtains a real Let's Encrypt certificate for this same nip.io hostname
// (CADDY_HOSTNAME there must match VPS_HOST here) and terminates TLS on
// :443 — the api container itself is no longer reachable on a public port.
// This fetch is always https:// as a result: previously it was plaintext
// HTTP straight to the api container's port, which meant every request this
// Worker forwarded — including login/register bodies and every Bearer
// token — crossed the public internet unencrypted between here and the VPS.
const PUBLIC_PREFIX = "/backend";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(`${PUBLIC_PREFIX}/`)) {
      if (!env.VPS_HOST) {
        return new Response("Worker misconfigured: VPS_HOST secret is not set", { status: 502 });
      }
      const nipHost = `${env.VPS_HOST.replaceAll(".", "-")}.nip.io`;
      const backendOrigin = `https://${nipHost}`;
      const backendPath = "/api" + url.pathname.slice(PUBLIC_PREFIX.length);
      const target = new URL(backendPath + url.search, backendOrigin);
      return fetch(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
};
