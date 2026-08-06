import { apiFetch } from "./client";
import type { User } from "./types";

export function register(email: string, password: string): Promise<{ user: User; token: string }> {
  return apiFetch("/auth/register", { method: "POST", body: { email, password } });
}

export function login(email: string, password: string): Promise<{ user: User; token: string }> {
  return apiFetch("/auth/login", { method: "POST", body: { email, password } });
}

export function logout(): Promise<void> {
  return apiFetch("/auth/logout", { method: "POST" });
}

export function me(): Promise<{ user: User }> {
  return apiFetch("/auth/me");
}
