import pino from "pino";
import { env } from "../config/env.js";

const VALID_LOG_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

// LOG_LEVEL overrides the NODE_ENV-based default without a redeploy — `deploro vps set-env
// LOG_LEVEL debug` plus a `vps deploy` to pick it up, then set back to unset once whatever's being
// chased is caught. Kept out of config/env.ts's zod schema deliberately: it's an operational dial,
// not a value the app's own logic branches on. Validated against pino's own level names rather than
// passed through raw — pino throws synchronously on an unrecognized level, and this is constructed
// as a module-level side effect that both server.ts and worker.ts import early, so a stray value
// (unset-via-empty-string, a typo) would otherwise crash the process at boot.
const requestedLevel = process.env.LOG_LEVEL;
const defaultLevel = env.NODE_ENV === "development" ? "debug" : "info";
export const logger = pino({
  level: requestedLevel && VALID_LOG_LEVELS.has(requestedLevel) ? requestedLevel : defaultLevel,
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
