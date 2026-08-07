import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { z } from "zod";
import { verifyConnectToken } from "../../lib/connect-token.js";
import { UnauthorizedError, ValidationError } from "../../lib/errors.js";
import { extractBearer, type AuthedRequest } from "../auth/auth.middleware.js";
import {
  createAccount,
  deleteAccount,
  getAccount,
  getConnectToken,
  listAccounts,
  saveAccountSession,
  updateAccount,
} from "./accounts.service.js";

const createSchema = z.object({
  handle: z.string().min(1).max(50),
  dailyScrapeLimit: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().positive().optional(),
});

const saveSessionSchema = z.object({
  storageState: z.record(z.unknown()),
  proxy: z
    .object({
      server: z.string().min(1),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .nullable()
    .optional(),
});

// npm scripts always run from the repo root, in both `tsx watch src/server.ts` (dev) and
// `node dist/src/server.js` (prod) — so process.cwd() reaching scripts/login.ts holds in either case.
const LOGIN_SCRIPT_PATH = path.join(process.cwd(), "scripts", "login.ts");

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

export async function connectToken(req: AuthedRequest, res: Response) {
  res.json(await getConnectToken(req.user!.id, req.params.id));
}

// No requireAuth on this route either (see accounts.routes.ts) — has to be fetchable by a plain
// terminal command (curl/Invoke-WebRequest) with no browser session, and the file itself holds no
// secrets (it's the same source already public in the repo).
export async function loginScript(_req: Request, res: Response) {
  const contents = await readFile(LOGIN_SCRIPT_PATH, "utf8");
  res.type("text/plain").setHeader("Content-Disposition", 'attachment; filename="talonr-login.ts"').send(contents);
}

// No requireAuth on this route (see accounts.routes.ts) — scripts/login.ts runs on whatever
// machine the account owner is on, authenticated by the connect token it was handed rather than a
// Deploro session.
export async function saveSession(req: Request, res: Response) {
  const claims = verifyConnectToken(extractBearer(req.headers.authorization) ?? "");
  if (!claims) throw new UnauthorizedError("Missing or expired connect token");

  const parsed = saveSessionSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");

  const account = await saveAccountSession(claims.userId, claims.accountId, parsed.data);
  res.json({ account });
}
