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

export function deleteAccount(id: string): Promise<void> {
  return apiFetch(`/accounts/${id}`, { method: "DELETE" });
}
