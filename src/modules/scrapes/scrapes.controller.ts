import type { Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import type { AuthedRequest } from "../auth/auth.middleware.js";
import { cancelScrapeJob, createScrapeJob, getScrapeJob, listScrapeJobs } from "./scrapes.service.js";

const createSchema = z.object({
  xAccountId: z.string().uuid(),
  sourceType: z.enum(["search", "followers", "likers"]),
  sourceRef: z.string().min(1),
  capLeads: z.number().int().positive().max(1000).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(["queued", "running", "completed", "failed", "paused"]).optional(),
  xAccountId: z.string().uuid().optional(),
});

export async function create(req: AuthedRequest, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
  res.status(201).json({ scrapeJob: await createScrapeJob(req.user!.id, parsed.data) });
}

export async function list(req: AuthedRequest, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query");
  res.json({ scrapeJobs: await listScrapeJobs(req.user!.id, parsed.data) });
}

export async function get(req: AuthedRequest, res: Response) {
  res.json({ scrapeJob: await getScrapeJob(req.user!.id, req.params.id) });
}

export async function cancel(req: AuthedRequest, res: Response) {
  res.json({ scrapeJob: await cancelScrapeJob(req.user!.id, req.params.id) });
}
