import { studioDelete, studioGet, studioInsert, studioList, studioUpdate } from "../../db/studio-client.js";
import type { XAccount } from "../../db/schema.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";

export interface PublicXAccount {
  id: string;
  handle: string;
  status: "active" | "checkpointed" | "banned";
  hasSession: boolean;
  hasProxy: boolean;
  dailyScrapeLimit: number;
  maxConcurrency: number;
  lastUsedAt: string | null;
  createdAt: string;
}

function toPublic(account: XAccount): PublicXAccount {
  return {
    id: account.id,
    handle: account.handle,
    status: account.status,
    hasSession: account.encryptedSession !== null,
    hasProxy: account.encryptedProxy !== null,
    dailyScrapeLimit: account.dailyScrapeLimit,
    maxConcurrency: account.maxConcurrency,
    lastUsedAt: account.lastUsedAt,
    createdAt: account.createdAt,
  };
}

export async function listAccounts(userId: string): Promise<PublicXAccount[]> {
  const { rows } = await studioList<XAccount>("x_accounts", { filter: { userId }, limit: 1000 });
  return rows.map(toPublic);
}

async function findOwnedOrThrow(userId: string, accountId: string): Promise<XAccount> {
  const account = await studioGet<XAccount>("x_accounts", accountId);
  if (!account || account.userId !== userId) throw new NotFoundError("X account not found");
  return account;
}

export async function getAccount(userId: string, accountId: string): Promise<PublicXAccount> {
  return toPublic(await findOwnedOrThrow(userId, accountId));
}

export async function createAccount(
  userId: string,
  input: { handle: string; dailyScrapeLimit?: number; maxConcurrency?: number }
): Promise<PublicXAccount> {
  const account = await studioInsert<XAccount>("x_accounts", {
    userId,
    handle: input.handle,
    ...(input.dailyScrapeLimit !== undefined ? { dailyScrapeLimit: input.dailyScrapeLimit } : {}),
    ...(input.maxConcurrency !== undefined ? { maxConcurrency: input.maxConcurrency } : {}),
  });
  return toPublic(account);
}

export async function updateAccount(
  userId: string,
  accountId: string,
  input: Partial<{
    dailyScrapeLimit: number;
    maxConcurrency: number;
    status: "active" | "checkpointed" | "banned";
  }>
): Promise<PublicXAccount> {
  const existing = await findOwnedOrThrow(userId, accountId);

  // `checkpointed` is set automatically by the worker on captcha/login-challenge/rate-limit
  // detection — the whole point is to stop retrying against X until a human re-verifies via the
  // login script. Letting the owner flip it straight back to `active` here would let them silently
  // bypass that safety check the instant it trips.
  if (input.status === "active" && existing.status !== "active") {
    throw new ValidationError(
      "Cannot reactivate a checkpointed or banned account this way — re-run the login script to resume scraping."
    );
  }

  const account = await studioUpdate<XAccount>("x_accounts", accountId, input);
  return toPublic(account);
}

export async function deleteAccount(userId: string, accountId: string): Promise<void> {
  await findOwnedOrThrow(userId, accountId);
  await studioDelete("x_accounts", accountId);
}
