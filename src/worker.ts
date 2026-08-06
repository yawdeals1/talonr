import { logger } from "./lib/logger.js";
import { startScrapeWorker } from "./queue/workers/scrape.worker.js";

const worker = startScrapeWorker();

logger.info("Talonr scrape worker started");

async function shutdown() {
  logger.info("Shutting down scrape worker...");
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
