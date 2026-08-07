import { studioGet, studioInsert, studioList } from "../../db/studio-client.js";
import type { User } from "../../db/schema.js";
import { logActivity } from "../activity/activity.service.js";
import * as deploroAuth from "./deploro-auth.client.js";

export interface PublicUser {
  id: string;
  email: string;
  role: "user" | "admin";
  createdAt: string;
}

function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
}

/** Finds the local user row for a Deploro account, auto-provisioning one on first sign-in. */
async function getOrCreateLocalUser(deploroAccountId: string, email: string): Promise<User> {
  const { rows } = await studioList<User>("users", { filter: { deploroAccountId } });
  if (rows[0]) return rows[0];

  const created = await studioInsert<User>("users", { email, deploroAccountId, role: "user" });
  await logActivity(created.id, "user.provisioned", { email });
  return created;
}

export async function registerUser(email: string, password: string): Promise<{ message: string }> {
  await deploroAuth.signupEmailPassword(email, password);
  return { message: "Check your email to confirm your account, then log in." };
}

export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  await deploroAuth.requestPasswordReset(email);
  return { message: "If that account exists, check your email for a reset link." };
}

/** Deploro revokes all sessions on reset and doesn't issue a new one — the caller logs in fresh. */
export async function resetPassword(token: string, password: string): Promise<{ message: string }> {
  await deploroAuth.resetPassword(token, password);
  return { message: "Password reset. Log in with your new password." };
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
  const user = await studioGet<User>("users", id);
  return user ? toPublicUser(user) : undefined;
}
