import type { Response } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import type { AuthedRequest } from "./auth.middleware.js";
import { getUserById, loginUser, registerUser } from "./auth.service.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function setAuthCookie(res: Response, token: string) {
  res.cookie("talonr_token", token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

export async function register(req: AuthedRequest, res: Response) {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");

  const { user, token } = await registerUser(parsed.data.email, parsed.data.password);
  setAuthCookie(res, token);
  res.status(201).json({ user, token });
}

export async function login(req: AuthedRequest, res: Response) {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");

  const { user, token } = await loginUser(parsed.data.email, parsed.data.password);
  setAuthCookie(res, token);
  res.json({ user, token });
}

export function logout(_req: AuthedRequest, res: Response) {
  res.clearCookie("talonr_token", { path: "/" });
  res.status(204).send();
}

export async function me(req: AuthedRequest, res: Response) {
  const user = await getUserById(req.user!.id);
  if (!user) throw new NotFoundError("User not found");
  res.json({ user });
}
