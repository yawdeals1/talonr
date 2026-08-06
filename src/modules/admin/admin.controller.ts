import type { Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import type { AuthedRequest } from "../auth/auth.middleware.js";
import { listActivity, listAllScrapeJobs, listAllUsers, listUserAccounts } from "./admin.service.js";

export async function users(_req: AuthedRequest, res: Response) {
  res.json({ users: await listAllUsers() });
}

export async function userAccounts(req: AuthedRequest, res: Response) {
  res.json({ accounts: await listUserAccounts(req.params.id) });
}

const scrapeJobsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: z.enum(["queued", "running", "completed", "failed", "paused"]).optional(),
});

export async function scrapeJobs(req: AuthedRequest, res: Response) {
  const parsed = scrapeJobsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query");
  res.json({ scrapeJobs: await listAllScrapeJobs(parsed.data) });
}

const activityQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function activity(req: AuthedRequest, res: Response) {
  const parsed = activityQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query");
  res.json(await listActivity(parsed.data));
}
