import type { Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import { X_HANDLE_PATTERN, X_TWEET_URL_PATTERN } from "../../scraper/types.js";
import type { AuthedRequest } from "../auth/auth.middleware.js";
import {
  cancelScrapeJob,
  createScrapeJob,
  deleteScrapeJob,
  deleteScrapeJobs,
  finishScrapeJobEarly,
  getScrapeJob,
  listScrapeJobLeads,
  listScrapeJobs,
  updateScrapeResultFilter,
} from "./scrapes.service.js";

const resultFilterSchema = z
  .object({
    minFollowers: z.number().int().nonnegative().optional(),
    maxFollowers: z.number().int().nonnegative().optional(),
    location: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.minFollowers !== undefined &&
      data.maxFollowers !== undefined &&
      data.minFollowers > data.maxFollowers
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxFollowers"],
        message: "Maximum followers must be greater than or equal to minimum followers",
      });
    }
  });

// sourceRef ends up in the worker's Playwright page.goto() (see scraper/sources/*.source.ts) — for
// "followers"/"engagers" it must be constrained to X's own handle/tweet-URL shape, or a user could
// point the scrape worker's browser at an arbitrary URL (SSRF against internal network/cloud
// metadata endpoints). "search" stays free-form since it's a genuine keyword query, never a URL.
//
// "likers" is deliberately not creatable here — X made "who liked a post" private platform-wide
// in June 2024 with no workaround, so every likers job would just fail. It stays a legal
// SourceType only so historical rows still typecheck (see db/schema.ts).
const createSchema = z
  .object({
    xAccountId: z.string().uuid(),
    sourceType: z.enum(["search", "followers", "engagers"]),
    sourceRef: z.string().min(1).max(2000),
    engagementTypes: z.array(z.enum(["repliers", "retweeters"])).min(1).optional(),
    capLeads: z.number().int().positive().max(1000).optional(),
    resultFilterDefinition: resultFilterSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.sourceType === "followers" && !X_HANDLE_PATTERN.test(data.sourceRef)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceRef"],
        message: "sourceRef must be an X handle (letters, numbers, underscore, max 15 chars)",
      });
    }
    if (data.sourceType === "engagers") {
      if (!X_TWEET_URL_PATTERN.test(data.sourceRef)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceRef"],
          message: "sourceRef must be a full x.com/twitter.com tweet URL",
        });
      }
      if (!data.engagementTypes || data.engagementTypes.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["engagementTypes"],
          message: "Select at least one engagement type (repliers, retweeters)",
        });
      }
    }
  });

const listQuerySchema = z.object({
  status: z.enum(["queued", "running", "completed", "failed", "paused"]).optional(),
  xAccountId: z.string().uuid().optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

const bulkDeleteSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

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

export async function listLeads(req: AuthedRequest, res: Response) {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query");
  res.json(await listScrapeJobLeads(req.user!.id, req.params.id, parsed.data.page, parsed.data.pageSize));
}

export async function updateResultFilter(req: AuthedRequest, res: Response) {
  const parsed = resultFilterSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
  res.json({ scrapeJob: await updateScrapeResultFilter(req.user!.id, req.params.id, parsed.data) });
}

export async function cancel(req: AuthedRequest, res: Response) {
  res.json({ scrapeJob: await cancelScrapeJob(req.user!.id, req.params.id) });
}

export async function finishEarly(req: AuthedRequest, res: Response) {
  res.json({ scrapeJob: await finishScrapeJobEarly(req.user!.id, req.params.id) });
}

export async function remove(req: AuthedRequest, res: Response) {
  await deleteScrapeJob(req.user!.id, req.params.id);
  res.status(204).send();
}

export async function bulkRemove(req: AuthedRequest, res: Response) {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
  res.json({ deletedCount: await deleteScrapeJobs(req.user!.id, parsed.data.ids) });
}
