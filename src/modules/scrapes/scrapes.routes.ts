import type { Request } from "express";
import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireUuidParam } from "../../lib/validate-params.js";
import type { AuthedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { cancel, create, get, list } from "./scrapes.controller.js";

export const scrapesRouter = Router();

scrapesRouter.use(requireAuth);

// Per-account daily quota/concurrency (queue/rate-limit/*) already bounds actual scraping, but
// nothing stopped a user from flooding scrape_jobs inserts + BullMQ jobs that all instantly no-op —
// keyed by user id (requireAuth above already populated req.user by the time this runs).
const createLimiter = rateLimit({
  windowSeconds: 60,
  limit: 20,
  keyPrefix: "scrape-create",
  keyFn: (req: Request) => (req as AuthedRequest).user!.id,
});

scrapesRouter.post("/", createLimiter, asyncHandler(create));
scrapesRouter.get("/", asyncHandler(list));
scrapesRouter.get("/:id", requireUuidParam("id"), asyncHandler(get));
scrapesRouter.post("/:id/cancel", requireUuidParam("id"), asyncHandler(cancel));
