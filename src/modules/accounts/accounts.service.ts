import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { xAccounts } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";

export interface PublicXAccount {
  id: string;
  handle: string;
  status: "active" | "checkpointed" | "banned";
  hasSession: boolean;
  hasProxy: boolean;
  dailyScrapeLimit: number;
  maxConcurrency: number;
  lastUsedAt: Date | null;
  createdAt: Date;
}

function toPublic(account: typeof xAccounts.$inferSelect): PublicXAccount {
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
  const rows = await db.query.xAccounts.findMany({ where: eq(xAccounts.userId, userId) });
  return rows.map(toPublic);
}

async function findOwnedOrThrow(userId: string, accountId: string) {
  const account = await db.query.xAccounts.findFirst({
    where: and(eq(xAccounts.id, accountId), eq(xAccounts.userId, userId)),
  });
  if (!account) throw new NotFoundError("X account not found");
  return account;
}

export async function getAccount(userId: string, accountId: string): Promise<PublicXAccount> {
  return toPublic(await findOwnedOrThrow(userId, accountId));
}

export async function createAccount(
  userId: string,
  input: { handle: string; dailyScrapeLimit?: number; maxConcurrency?: number }
): Promise<PublicXAccount> {
  const [account] = await db
    .insert(xAccounts)
    .values({
      userId,
      handle: input.handle,
      dailyScrapeLimit: input.dailyScrapeLimit,
      maxConcurrency: input.maxConcurrency,
    })
    .returning();
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
  await findOwnedOrThrow(userId, accountId);
  const [account] = await db
    .update(xAccounts)
    .set(input)
    .where(and(eq(xAccounts.id, accountId), eq(xAccounts.userId, userId)))
    .returning();
  return toPublic(account);
}

export async function deleteAccount(userId: string, accountId: string): Promise<void> {
  await findOwnedOrThrow(userId, accountId);
  await db.delete(xAccounts).where(and(eq(xAccounts.id, accountId), eq(xAccounts.userId, userId)));
}
