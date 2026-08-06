import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

export interface JwtPayload {
  sub: string;
  email: string;
  role: "user" | "admin";
}

const EXPIRES_IN = "7d";

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyJwt(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
