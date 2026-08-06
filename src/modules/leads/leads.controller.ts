import type { Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import type { AuthedRequest } from "../auth/auth.middleware.js";
import { getLead, listLeads } from "./leads.service.js";

const listQuerySchema = z.object({
  handle: z.string().optional(),
  sourceType: z.enum(["search", "followers", "likers"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function list(req: AuthedRequest, res: Response) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query");
  res.json(await listLeads(req.user!.id, parsed.data));
}

export async function get(req: AuthedRequest, res: Response) {
  res.json({ lead: await getLead(req.user!.id, req.params.id) });
}
