import type { Response } from "express";
import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import type { AuthedRequest } from "../auth/auth.middleware.js";
import { createAccount, deleteAccount, getAccount, listAccounts, updateAccount } from "./accounts.service.js";

const createSchema = z.object({
  handle: z.string().min(1).max(50),
  dailyScrapeLimit: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().positive().optional(),
});

const updateSchema = z.object({
  dailyScrapeLimit: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  status: z.enum(["active", "checkpointed", "banned"]).optional(),
});

export async function list(req: AuthedRequest, res: Response) {
  res.json({ accounts: await listAccounts(req.user!.id) });
}

export async function get(req: AuthedRequest, res: Response) {
  res.json({ account: await getAccount(req.user!.id, req.params.id) });
}

export async function create(req: AuthedRequest, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
  res.status(201).json({ account: await createAccount(req.user!.id, parsed.data) });
}

export async function update(req: AuthedRequest, res: Response) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
  res.json({ account: await updateAccount(req.user!.id, req.params.id, parsed.data) });
}

export async function remove(req: AuthedRequest, res: Response) {
  await deleteAccount(req.user!.id, req.params.id);
  res.status(204).send();
}
