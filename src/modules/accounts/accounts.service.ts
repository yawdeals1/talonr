import { studioDelete, studioGet, studioInsert, studioList, studioUpdate } from "../../db/studio-client.js";
import type { XAccount } from "../../db/schema.js";
import { issueConnectToken, type ConnectToken } from "../../lib/connect-token.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { accountCheckQueue } from "../../queue/queues.js";
import {
  clearAccountCooldown,
  getAccountCooldown,
  getAccountCooldowns,
} from "../../queue/rate-limit/account-cooldown.js";
import { encryptProxy, encryptSession, type ProxyConfig } from "../../scraper/session-store.js";
import {
  clearAccountSessionCheck,
  getAccountSessionCheck,
  getAccountSessionChecks,
  setAccountSessionCheck,
  type AccountSessionCheck,
} from "./account-check.store.js";

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
  /**
   * Set while X is throttling this account. It is still connected and still `active` — it is
   * resting, and queued jobs start themselves once this passes. Deliberately distinct from
   * `checkpointed`, which means the session itself needs re-verifying.
   */
  cooldownUntil: string | null;
  cooldownReason: string | null;
  /** Result of the most recent session re-check, while it is still fresh. */
  sessionCheck: AccountSessionCheck | null;
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
    cooldownUntil: null,
    cooldownReason: null,
    sessionCheck: null,
  };
}

/**
 * Adds the two pieces of account state that live in Redis rather than the database — the
 * rate-limit cooldown and the latest session re-check.
 *
 * Both are deliberately transient (see account-cooldown.ts / account-check.store.ts), but without
 * them the accounts list can't explain itself: an account that is `active` and yet runs nothing
 * looks broken until you can see that it is resting off a 429.
 */
async function withRuntimeState(account: XAccount): Promise<PublicXAccount> {
  const [cooldown, sessionCheck] = await Promise.all([
    getAccountCooldown(account.id),
    getAccountSessionCheck(account.id),
  ]);
  return {
    ...toPublic(account),
    cooldownUntil: cooldown?.until.toISOString() ?? null,
    cooldownReason: cooldown?.reason ?? null,
    sessionCheck,
  };
}

export async function listAccounts(userId: string): Promise<PublicXAccount[]> {
  const { rows } = await studioList<XAccount>("x_accounts", { filter: { userId }, limit: 1000 });
  const ids = rows.map((row) => row.id);
  const [cooldowns, checks] = await Promise.all([getAccountCooldowns(ids), getAccountSessionChecks(ids)]);

  return rows.map((row) => {
    const cooldown = cooldowns.get(row.id);
    return {
      ...toPublic(row),
      cooldownUntil: cooldown?.until.toISOString() ?? null,
      cooldownReason: cooldown?.reason ?? null,
      sessionCheck: checks.get(row.id) ?? null,
    };
  });
}

async function findOwnedOrThrow(userId: string, accountId: string): Promise<XAccount> {
  const account = await studioGet<XAccount>("x_accounts", accountId);
  if (!account || account.userId !== userId) throw new NotFoundError("X account not found");
  return account;
}

export async function getAccount(userId: string, accountId: string): Promise<PublicXAccount> {
  return withRuntimeState(await findOwnedOrThrow(userId, accountId));
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

  // `checkpointed` is set by the worker when X challenges the session (captcha or a login wall) —
  // the whole point is to stop retrying against X until the session is verified again. Letting the
  // owner flip it straight back to `active` here would bypass that check the instant it trips.
  // `requestAccountRevalidation` below is the supported way out: it performs the verification
  // rather than skipping it. (Rate limits no longer land here at all — they rest the account on a
  // cooldown and leave it active; see queue/rate-limit/account-cooldown.ts.)
  if (input.status === "active" && existing.status !== "active") {
    throw new ValidationError(
      "Cannot reactivate a checkpointed or banned account this way — re-check the session, or reconnect the account, to resume scraping."
    );
  }

  const account = await studioUpdate<XAccount>("x_accounts", accountId, input);
  return withRuntimeState(account);
}

/**
 * Asks the worker to re-verify a checkpointed account's stored session against X.
 *
 * This is an alternative to re-running the interactive login script, not a way around the guard
 * above. Nothing is waved away: the worker makes a real authenticated request to X with the
 * cookies already on file and only flips the account back to `active` when X answers with a
 * signed-in session — the same fact a manual re-login establishes, minus the manual part. If X
 * doesn't, the account stays exactly as it is and reconnecting remains the answer.
 */
export async function requestAccountRevalidation(userId: string, accountId: string): Promise<PublicXAccount> {
  const account = await findOwnedOrThrow(userId, accountId);

  if (account.status === "active") {
    throw new ValidationError("This account is already active — there is nothing to re-check.");
  }
  // `banned` is only ever set by hand, so it records a decision someone made rather than a signal
  // the scraper tripped. A session check has no business overturning that.
  if (account.status === "banned") {
    throw new ValidationError("Banned accounts can't be re-checked. Reconnect the account instead.");
  }
  if (!account.encryptedSession) {
    throw new ValidationError("This account has no saved session yet — connect it first.");
  }

  const queued: AccountSessionCheck = { state: "queued", at: new Date().toISOString() };
  await setAccountSessionCheck(accountId, queued);
  await accountCheckQueue.add("check-session", { userId, xAccountId: accountId });

  return { ...toPublic(account), sessionCheck: queued };
}

export async function deleteAccount(userId: string, accountId: string): Promise<void> {
  await findOwnedOrThrow(userId, accountId);
  await studioDelete("x_accounts", accountId);
}

// Mints a token scripts/login.ts can use in place of a Deploro session — that script runs on
// whatever machine the account owner is on, which may never have this repo, its .env, or its
// Studio DB / encryption secrets. Ownership-checked here at issue time so the token itself is the
// only thing that ever needs to travel to that machine.
export async function getConnectToken(userId: string, accountId: string): Promise<ConnectToken> {
  await findOwnedOrThrow(userId, accountId);
  return issueConnectToken(userId, accountId);
}

// Called by scripts/login.ts after a manual X login, authenticated by a connect token rather than
// a Deploro session. userId/accountId here come from that token's verified claims, not from the
// request body, so a forged or reused body can't redirect the write to a different account.
export async function saveAccountSession(
  userId: string,
  accountId: string,
  input: { storageState: object; proxy?: ProxyConfig | null }
): Promise<PublicXAccount> {
  const existing = await findOwnedOrThrow(userId, accountId);
  const account = await studioUpdate<XAccount>("x_accounts", existing.id, {
    encryptedSession: encryptSession(input.storageState),
    encryptedProxy: input.proxy ? encryptProxy(input.proxy) : existing.encryptedProxy,
    status: "active",
    lastUsedAt: new Date(),
  });
  // A freshly captured session supersedes both: whatever throttling or failed check applied to the
  // old one says nothing about this one.
  await Promise.all([clearAccountCooldown(existing.id), clearAccountSessionCheck(existing.id)]);
  return toPublic(account);
}
