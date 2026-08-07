import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { byBodyEmail, byIp, rateLimit } from "../../lib/rate-limit.js";
import { login, logout, me, register, requestPasswordReset, resetPassword } from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";

export const authRouter = Router();

// Talonr forwards every attempt to Deploro Auth — without a limiter here, credential stuffing and
// brute force cost real outbound requests regardless of whatever protection Deploro has upstream.
// IP-based limiting is coarse (best-effort — see lib/rate-limit.ts#byIp), so login/reset also key
// on the attempted email, which is the more meaningful dimension for brute-force protection.
const ipLimiter = rateLimit({ windowSeconds: 15 * 60, limit: 30, keyPrefix: "auth-ip", keyFn: byIp });
const loginEmailLimiter = rateLimit({ windowSeconds: 15 * 60, limit: 8, keyPrefix: "login-email", keyFn: byBodyEmail });
const resetEmailLimiter = rateLimit({ windowSeconds: 15 * 60, limit: 5, keyPrefix: "reset-email", keyFn: byBodyEmail });

authRouter.post("/register", ipLimiter, asyncHandler(register));
authRouter.post("/login", ipLimiter, loginEmailLimiter, asyncHandler(login));
authRouter.post("/request-password-reset", ipLimiter, resetEmailLimiter, asyncHandler(requestPasswordReset));
authRouter.post("/reset-password", ipLimiter, asyncHandler(resetPassword));
authRouter.post("/logout", requireAuth, asyncHandler(logout));
authRouter.get("/me", requireAuth, asyncHandler(me));
