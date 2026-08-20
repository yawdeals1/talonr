import { apiFetch } from "./client";
import type { XAccount, XAccountStatus } from "./types";

export function listAccounts(): Promise<{ accounts: XAccount[] }> {
  return apiFetch("/accounts");
}

export function getAccount(id: string): Promise<{ account: XAccount }> {
  return apiFetch(`/accounts/${id}`);
}

export interface CreateAccountInput {
  handle: string;
  dailyScrapeLimit?: number;
  maxConcurrency?: number;
}

export function createAccount(input: CreateAccountInput): Promise<{ account: XAccount }> {
  return apiFetch("/accounts", { method: "POST", body: input });
}

export interface UpdateAccountInput {
  dailyScrapeLimit?: number;
  maxConcurrency?: number;
  status?: XAccountStatus;
}

export function updateAccount(id: string, input: UpdateAccountInput): Promise<{ account: XAccount }> {
  return apiFetch(`/accounts/${id}`, { method: "PATCH", body: input });
}

/**
 * Asks the backend to verify a checkpointed account's saved session against X, instead of the user
 * re-running the login script. Returns immediately — the check runs in the worker, so the verdict
 * shows up on the account itself (`status` flips to active, or `sessionCheck` explains why not).
 */
export function revalidateAccount(id: string): Promise<{ account: XAccount }> {
  return apiFetch(`/accounts/${id}/revalidate`, { method: "POST" });
}

export function deleteAccount(id: string): Promise<void> {
  return apiFetch(`/accounts/${id}`, { method: "DELETE" });
}

export interface ConnectToken {
  token: string;
  expiresAt: string;
}

export function getConnectToken(id: string): Promise<ConnectToken> {
  return apiFetch(`/accounts/${id}/connect-token`);
}
