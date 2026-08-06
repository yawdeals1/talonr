// DIAGNOSTIC BUILD — temporarily proxies to a known-good HTTPS domain instead
// of the VPS raw IP, to isolate whether the 403/1003 block is about the
// inbound path, plain-HTTP origin, or raw-IP origin specifically.
const BACKEND_ORIGIN = "https://example.com";
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
