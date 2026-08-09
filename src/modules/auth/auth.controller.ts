import type { Response } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../lib/errors.js";
import { isDisposableEmail } from "../../lib/disposable-email.js";
import { byIp } from "../../lib/rate-limit.js";
import { verifyTurnstileToken } from "../../lib/turnstile.js";
import * as deploroAuth from "./deploro-auth.client.js";
import type { AuthedRequest } from "./auth.middleware.js";
import { getUserById, loginUser, registerUser, requestPasswordReset as requestPasswordResetService, resetPassword as resetPasswordService } from "./auth.service.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

// Stricter than Deploro Auth's own 8-char-only minimum — enforced here so weak passwords never
// reach Deploro in the first place. Only applies where a *new* password is being set (register,
// reset): an existing account's password was valid under whatever rule was in effect when it was
// set, and must keep logging in under loginSchema regardless of these criteria changing later.
const passwordCriteriaSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number");

const registerSchema = z.object({
  email: z
    .string()
    .email()
    .refine((email) => !isDisposableEmail(email), {
      message: "Disposable or temporary email addresses are not allowed. Please use a permanent email address.",
    }),
  password: passwordCriteriaSchema,
  turnstileToken: z.string().min(1, "Verification check is required"),
});

const requestResetSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: passwordCriteriaSchema,
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

  // Verified before anything else touches Deploro — a failed/missing/replayed Turnstile token
  // never reaches the disposable-email check or the signup call itself.
  const verified = await verifyTurnstileToken(parsed.data.turnstileToken, byIp(req));
  if (!verified) throw new ForbiddenError("Verification check failed. Please try again.");

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

export async function requestPasswordReset(req: AuthedRequest, res: Response) {
  const parsed = requestResetSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");

  const { message } = await requestPasswordResetService(parsed.data.email);
  res.status(202).json({ message });
}

export async function resetPassword(req: AuthedRequest, res: Response) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");

  const { message } = await resetPasswordService(parsed.data.token, parsed.data.password);
  res.status(200).json({ message });
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
