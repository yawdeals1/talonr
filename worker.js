// Cloudflare Worker for the deployed frontend's Worker/Pages site.
//
// Static assets (the Vite build in dist/) are served automatically for
// matching paths. Anything under /backend/* falls through to this fetch
// handler, which proxies it server-side to the VPS-hosted backend — a
// Worker-to-origin fetch, not a browser request, so it isn't subject to
// mixed-content blocking. The browser only ever talks to this Worker's own
// domain; the VPS's address never appears client-side.
//
// The VPS host/port live in Worker secrets (VPS_HOST, VPS_PORT — set via
// `deploro hosting set-env`), not hardcoded here, so a VPS migration or port
// change is a config update through the platform rather than a source edit.
//
// Two platform quirks this works around, confirmed empirically:
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
// KNOWN GAP: this fetch is plain http://, not https:// — the VPS is shared
// across multiple Deploro projects and its ports 80/443 already belong to
// the platform's own nginx, so a per-project Caddy/Let's Encrypt setup on
// this compute stack can't bind the ports ACME validation requires (a
// same-VPS Caddy attempt on 2026-08-07 failed with "address already in
// use" on :80 and broke the public route to this container until reverted
// — see docker-compose.yml history). Every request this Worker forwards,
// including login/register bodies and Bearer tokens, crosses the public
// internet unencrypted until this gets a real fix (an owned domain with a
// DNS-01 challenge, or a routing rule on the platform's shared nginx that
// forwards ACME HTTP-01 challenges through to this container).
const PUBLIC_PREFIX = "/backend";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(`${PUBLIC_PREFIX}/`)) {
      if (!env.VPS_HOST) {
        return new Response("Worker misconfigured: VPS_HOST secret is not set", { status: 502 });
      }
      const nipHost = `${env.VPS_HOST.replaceAll(".", "-")}.nip.io`;
      const backendOrigin = `http://${nipHost}:${env.VPS_PORT ?? "3000"}`;
      const backendPath = "/api" + url.pathname.slice(PUBLIC_PREFIX.length);
      const target = new URL(backendPath + url.search, backendOrigin);
      return fetch(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
};
