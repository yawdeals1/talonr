import type { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { verifyJwt } from "./jwt.js";

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

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const token = req.cookies?.talonr_token ?? extractBearer(req.headers.authorization);
  if (!token) {
    next(new UnauthorizedError("Missing authentication token"));
    return;
  }
  try {
    const payload = verifyJwt(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
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
