import pino from "pino";
import { env } from "../config/env.js";

// LOG_LEVEL overrides the NODE_ENV-based default without a redeploy — `deploro vps set-env
// LOG_LEVEL debug` plus a `vps deploy` to pick it up, then set back to unset once whatever's being
// chased is caught. Kept out of config/env.ts's zod schema deliberately: it's an operational dial,
// not a value the app's own logic branches on.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env.NODE_ENV === "development" ? "debug" : "info"),
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
