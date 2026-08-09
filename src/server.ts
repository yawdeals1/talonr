import { app } from "./app.js";
import { env } from "./config/env.js";
import { refreshDisposableEmailBlocklist, startDisposableEmailBlocklistRefresh } from "./lib/disposable-email.js";
import { logger } from "./lib/logger.js";

// Best-effort and bounded (~5s) — never blocks startup on a slow/unreachable network, see
// disposable-email.ts. Runs before listen() so the freshest blocklist is in place for the very
// first registration, not just ones after the first 24h background refresh.
await refreshDisposableEmailBlocklist();
startDisposableEmailBlocklistRefresh();

app.listen(env.PORT, () => {
  logger.info(`Talonr API listening on port ${env.PORT}`);
});
