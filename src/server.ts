import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

app.listen(env.PORT, () => {
  logger.info(`Talonr API listening on port ${env.PORT}`);
});
