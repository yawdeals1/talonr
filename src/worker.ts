import { logger } from "./lib/logger.js";
import { startAccountCheckWorker } from "./queue/workers/account-check.worker.js";
import { startScrapeWorker } from "./queue/workers/scrape.worker.js";

const scrapeWorker = startScrapeWorker();
// Shares this process because it needs the same two things only the worker has: Playwright, and
// the ability to decrypt a stored X session.
const accountCheckWorker = startAccountCheckWorker();

logger.info("Talonr scrape worker started");

async function shutdown() {
  logger.info("Shutting down scrape worker...");
  await Promise.all([scrapeWorker.close(), accountCheckWorker.close()]);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
