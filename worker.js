// DIAGNOSTIC 2 — plain HTTP to a real domain (not an IP), to isolate whether
// it's "plain HTTP" or "raw IP" specifically that's blocked.
const BACKEND_ORIGIN = "http://example.com";
const PUBLIC_PREFIX = "/backend";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(`${PUBLIC_PREFIX}/`)) {
      const backendPath = "/" + url.pathname.slice(PUBLIC_PREFIX.length + 1);
      const target = new URL(backendPath + url.search, BACKEND_ORIGIN);
      return fetch(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
};
