import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import helmet from "helmet";
import { env } from "./config/env.js";
import { studioList } from "./db/studio-client.js";
import { redisConnection } from "./queue/connection.js";
import { errorHandler } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { accountsRouter } from "./modules/accounts/accounts.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { requireAuth, type AuthedRequest } from "./modules/auth/auth.middleware.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { leadListsRouter } from "./modules/lead-lists/lead-lists.routes.js";
import { leadsRouter } from "./modules/leads/leads.routes.js";
import { scrapesRouter } from "./modules/scrapes/scrapes.routes.js";

export const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        // Lead avatars are stored as X's public pbs.twimg.com URLs. Keep external images
        // default-denied while allowing that single CDN alongside local/data images.
        imgSrc: ["'self'", "data:", "https://pbs.twimg.com"],
      },
    },
  })
);
app.use(cors({ origin: env.ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", async (_req, res) => {
  try {
    await studioList("users", { limit: 1 });
    await redisConnection.ping();
    res.json({ status: "ok" });
  } catch (err) {
    // Publicly reachable, unauthenticated — never echo internal exception details (Studio DB/Redis
    // error text) back to the caller. Log server-side instead.
    logger.error({ err }, "health check failed");
    res.status(503).json({ status: "unavailable" });
  }
});

// Default-deny backstop: every module router below already calls `router.use(requireAuth)`
// itself, but that means a future router mounted here without remembering to add it would be
// silently public. This gate makes auth the default for anything under /api/* except the
// explicit public paths, so a missing per-router check fails closed instead of open. The
// per-router checks stay in place too — requireAuth is idempotent (cheap cache hit on the
// second call), so this is pure defense in depth, not a behavior change for existing routes.
const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
  // Not actually unauthenticated — scripts/login.ts posts here with a short-lived, account-scoped
  // connect token (see lib/connect-token.ts) instead of a Deploro session, since it runs on
  // whatever machine the account owner is on. "Public" only in the sense that this backstop's
  // Deploro-session check doesn't apply; accounts.controller.ts#saveSession still verifies it.
  "/api/accounts/session",
  // Genuinely public: scripts/login.ts's own source, no secrets in it. Has to be fetchable by a
  // plain terminal command with no browser session at all — see accounts.controller.ts#loginScript.
  "/api/accounts/login-script",
];

function isPublicApiPath(path: string): boolean {
  return PUBLIC_API_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/") || isPublicApiPath(req.path)) {
    next();
    return;
  }
  requireAuth(req as AuthedRequest, res, next);
});

app.use("/api/auth", authRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/scrapes", scrapesRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/lead-lists", leadListsRouter);
app.use("/api/admin", adminRouter);

// Serves the built frontend when this process is the one a domain routes to directly — the VPS
// compute deploy publishes an HTTP port (docker-compose.yml's `api` service), which the platform
// then points talonr.deploro.app's DNS at directly, bypassing the Cloudflare Worker that normally
// serves the frontend. Guarded by an existence check since local dev runs the frontend separately
// via Vite and never has frontend/dist built.
const FRONTEND_DIST = path.join(process.cwd(), "frontend", "dist");
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

app.use(errorHandler);
