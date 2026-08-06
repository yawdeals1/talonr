import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { ConflictError, UnauthorizedError } from "../../lib/errors.js";
import { logActivity } from "../activity/activity.service.js";
import { signJwt } from "./jwt.js";
import { hashPassword, verifyPassword } from "./password.js";

export interface PublicUser {
  id: string;
  email: string;
  role: "user" | "admin";
  createdAt: Date;
}

function toPublicUser(user: typeof users.$inferSelect): PublicUser {
  return { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
}

export async function registerUser(email: string, password: string) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    throw new ConflictError("An account with this email already exists");
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, role: "user" })
    .returning();

  await logActivity(user.id, "user.registered", { email });

  const token = signJwt({ sub: user.id, email: user.email, role: user.role });
  return { user: toPublicUser(user), token };
}

export async function loginUser(email: string, password: string) {
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  await logActivity(user.id, "user.logged_in", { email });

  const token = signJwt({ sub: user.id, email: user.email, role: user.role });
  return { user: toPublicUser(user), token };
}

export async function getUserById(id: string): Promise<PublicUser | undefined> {
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  return user ? toPublicUser(user) : undefined;
}
