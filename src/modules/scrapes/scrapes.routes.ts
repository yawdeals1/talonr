import type { Request } from "express";
import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireUuidParam } from "../../lib/validate-params.js";
import type { AuthedRequest } from "../auth/auth.middleware.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  bulkRemove,
  cancel,
  continueRun,
  create,
  finishEarly,
  get,
  list,
  listLeads,
  pause,
  remove,
  resume,
  updateResultFilter,
} from "./scrapes.controller.js";

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
scrapesRouter.post("/bulk-delete", asyncHandler(bulkRemove));
scrapesRouter.get("/:id", requireUuidParam("id"), asyncHandler(get));
scrapesRouter.get("/:id/leads", requireUuidParam("id"), asyncHandler(listLeads));
scrapesRouter.patch("/:id/result-filter", requireUuidParam("id"), asyncHandler(updateResultFilter));
scrapesRouter.post("/:id/cancel", requireUuidParam("id"), asyncHandler(cancel));
scrapesRouter.post("/:id/finish", requireUuidParam("id"), asyncHandler(finishEarly));
scrapesRouter.post("/:id/pause", requireUuidParam("id"), asyncHandler(pause));
scrapesRouter.post("/:id/resume", requireUuidParam("id"), asyncHandler(resume));
// Enqueues a whole new run, so it goes through the same per-user create limiter as POST /scrapes —
// otherwise "continue" would be an unmetered way to do exactly what that limiter bounds.
scrapesRouter.post("/:id/continue", createLimiter, requireUuidParam("id"), asyncHandler(continueRun));
scrapesRouter.delete("/:id", requireUuidParam("id"), asyncHandler(remove));
