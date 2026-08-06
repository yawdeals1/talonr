import type { Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import type { AuthedRequest } from "../auth/auth.middleware.js";
import {
  createLeadList,
  deleteLeadList,
  evaluateLeadList,
  getLeadList,
  listLeadLists,
  updateLeadList,
} from "./lead-lists.service.js";

const filterDefinitionSchema = z.object({
  bioKeywords: z.array(z.string()).optional(),
  minFollowers: z.number().int().nonnegative().optional(),
  maxFollowers: z.number().int().nonnegative().optional(),
  location: z.string().optional(),
  verifiedOnly: z.boolean().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  filterDefinition: filterDefinitionSchema,
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  filterDefinition: filterDefinitionSchema.optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function list(req: AuthedRequest, res: Response) {
  res.json({ leadLists: await listLeadLists(req.user!.id) });
}

export async function get(req: AuthedRequest, res: Response) {
  res.json({ leadList: await getLeadList(req.user!.id, req.params.id) });
}

export async function create(req: AuthedRequest, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
  const leadList = await createLeadList(req.user!.id, parsed.data.name, parsed.data.filterDefinition);
  res.status(201).json({ leadList });
}

export async function update(req: AuthedRequest, res: Response) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
  res.json({ leadList: await updateLeadList(req.user!.id, req.params.id, parsed.data) });
}

export async function remove(req: AuthedRequest, res: Response) {
  await deleteLeadList(req.user!.id, req.params.id);
  res.status(204).send();
}

export async function evaluate(req: AuthedRequest, res: Response) {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query");
  res.json(await evaluateLeadList(req.user!.id, req.params.id, parsed.data.page, parsed.data.pageSize));
}
