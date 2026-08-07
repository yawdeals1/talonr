import type { Response } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import * as deploroAuth from "./deploro-auth.client.js";
import type { AuthedRequest } from "./auth.middleware.js";
import { getUserById, loginUser, registerUser } from "./auth.service.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

// Stricter than Deploro Auth's own 8-char-only minimum — enforced here so weak passwords never
// reach signup in the first place. Only applies to registration: an existing account's password
// was valid under whatever rule was in effect when it was set, and must keep logging in under
// loginSchema regardless of these criteria changing later.
const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[0-9]/, "Password must include a number")
    .regex(/[^A-Za-z0-9]/, "Password must include a special character"),
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

function extractToken(req: AuthedRequest): string | undefined {
  const header = req.headers.authorization;
  const [scheme, bearerToken] = header?.split(" ") ?? [];
  return req.cookies?.talonr_token ?? (scheme === "Bearer" ? bearerToken : undefined);
}

export async function register(req: AuthedRequest, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");

  const { message } = await registerUser(parsed.data.email, parsed.data.password);
  res.status(202).json({ message });
}

export async function login(req: AuthedRequest, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");

  const { user, token } = await loginUser(parsed.data.email, parsed.data.password);
  setAuthCookie(res, token);
  res.json({ user, token });
}

export async function logout(req: AuthedRequest, res: Response) {
  const token = extractToken(req);
  if (token) await deploroAuth.revokeSession(token);
  res.clearCookie("talonr_token", { path: "/" });
  res.status(204).send();
}

export async function me(req: AuthedRequest, res: Response) {
  const user = await getUserById(req.user!.id);
  if (!user) throw new NotFoundError("User not found");
  res.json({ user });
}
