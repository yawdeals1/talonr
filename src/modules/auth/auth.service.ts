import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { logActivity } from "../activity/activity.service.js";
import * as deploroAuth from "./deploro-auth.client.js";

export interface PublicUser {
  id: string;
  email: string;
  role: "user" | "admin";
  createdAt: Date;
}

function toPublicUser(user: typeof users.$inferSelect): PublicUser {
  return { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
}

/** Finds the local user row for a Deploro account, auto-provisioning one on first sign-in. */
async function getOrCreateLocalUser(deploroAccountId: string, email: string): Promise<typeof users.$inferSelect> {
  const existing = await db.query.users.findFirst({ where: eq(users.deploroAccountId, deploroAccountId) });
  if (existing) return existing;

  const [created] = await db.insert(users).values({ email, deploroAccountId, role: "user" }).returning();
  await logActivity(created.id, "user.provisioned", { email });
  return created;
}

export async function registerUser(email: string, password: string): Promise<{ message: string }> {
  await deploroAuth.signupEmailPassword(email, password);
  return { message: "Check your email to confirm your account, then log in." };
}

export async function loginUser(email: string, password: string): Promise<{ user: PublicUser; token: string }> {
  const { token, user: deploroUser } = await deploroAuth.loginEmailPassword(email, password);
  const localUser = await getOrCreateLocalUser(deploroUser.id, deploroUser.email ?? email);

  await logActivity(localUser.id, "user.logged_in", { email });

  return { user: toPublicUser(localUser), token };
}

/** Validates a Deploro session token and returns the matching (auto-provisioned) local user. Used by requireAuth. */
export async function validateAndSyncUser(token: string): Promise<PublicUser> {
  const deploroUser = await deploroAuth.validateSession(token);
  const localUser = await getOrCreateLocalUser(deploroUser.id, deploroUser.email ?? "");
  return toPublicUser(localUser);
}

export async function getUserById(id: string): Promise<PublicUser | undefined> {
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  return user ? toPublicUser(user) : undefined;
}
