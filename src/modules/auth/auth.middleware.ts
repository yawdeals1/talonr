import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError, ForbiddenError } from "../../lib/errors.js";
import { validateAndSyncUser, type PublicUser } from "./auth.service.js";

export interface AuthedUser {
  id: string;
  email: string;
  role: "user" | "admin";
}

export interface AuthedRequest extends Request {
  user?: AuthedUser;
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" ? token : undefined;
}

function toAuthedUser(user: PublicUser): AuthedUser {
  return { id: user.id, email: user.email, role: user.role };
}

// Every authenticated request would otherwise cost a network round trip to Deploro Auth
// before doing anything else — this short-lived cache keeps that off the hot path for
// back-to-back requests (dashboard polling, etc.) without meaningfully delaying role/status
// changes made on the Deploro side.
const SESSION_CACHE_TTL_MS = 60_000;
const sessionCache = new Map<string, { user: AuthedUser; expiresAt: number }>();

async function resolveUser(token: string): Promise<AuthedUser> {
  const cached = sessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const user = toAuthedUser(await validateAndSyncUser(token));
  sessionCache.set(token, { user, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  return user;
}

export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.talonr_token ?? extractBearer(req.headers.authorization);
  if (!token) {
    next(new UnauthorizedError("Missing authentication token"));
    return;
  }
  try {
    req.user = await resolveUser(token);
    next();
  } catch {
    next(new UnauthorizedError("Invalid or expired token"));
  }
}

export function requireAdmin(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    next(new ForbiddenError("Admin access required"));
    return;
  }
  next();
}
