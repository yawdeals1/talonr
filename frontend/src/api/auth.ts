import { apiFetch } from "./client";
import type { User } from "./types";

export function register(email: string, password: string, turnstileToken: string): Promise<{ message: string }> {
  return apiFetch("/auth/register", { method: "POST", body: { email, password, turnstileToken } });
}

export function login(email: string, password: string): Promise<{ user: User; token: string }> {
  return apiFetch("/auth/login", { method: "POST", body: { email, password } });
}

export function requestPasswordReset(email: string): Promise<{ message: string }> {
  return apiFetch("/auth/request-password-reset", { method: "POST", body: { email } });
}

// Deploro revokes all sessions on reset and doesn't issue a new one — log in fresh afterward.
export function resetPassword(token: string, password: string): Promise<{ message: string }> {
  return apiFetch("/auth/reset-password", { method: "POST", body: { token, password } });
}

export function logout(): Promise<void> {
  return apiFetch("/auth/logout", { method: "POST" });
}

export function me(): Promise<{ user: User }> {
  return apiFetch("/auth/me");
}
