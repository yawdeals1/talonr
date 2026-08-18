import type { Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import type { AuthedRequest } from "../auth/auth.middleware.js";
import { deleteLead, deleteLeads, getLead, listLeads } from "./leads.service.js";

const listQuerySchema = z.object({
  handle: z.string().optional(),
  // "likers" stays filterable so historical leads scraped before X locked down likes visibility
  // (June 2024) are still browsable — new leads can no longer be scraped with that source type.
  sourceType: z.enum(["search", "followers", "likers", "engagers"]).optional(),
  // Generic exact-match source reference filter. Scrape details use the exact-membership
  // /scrapes/:id/leads endpoint instead of approximating a run from sourceType + sourceRef.
  sourceRef: z.string().optional(),
  minFollowers: z.coerce.number().int().nonnegative().optional(),
  maxFollowers: z.coerce.number().int().nonnegative().optional(),
  location: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
}).superRefine((data, ctx) => {
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

const bulkDeleteSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) });

export async function list(req: AuthedRequest, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query");
  res.json(await listLeads(req.user!.id, parsed.data));
}

export async function get(req: AuthedRequest, res: Response) {
  res.json({ lead: await getLead(req.user!.id, req.params.id) });
}

export async function remove(req: AuthedRequest, res: Response) {
  await deleteLead(req.user!.id, req.params.id);
  res.status(204).send();
}

export async function bulkRemove(req: AuthedRequest, res: Response) {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
  res.json({ deletedCount: await deleteLeads(req.user!.id, parsed.data.ids) });
}
