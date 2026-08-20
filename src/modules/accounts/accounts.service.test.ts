import { beforeEach, describe, expect, it, vi } from "vitest";
import type { XAccount } from "../../db/schema.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import {
  deleteAccount,
  getAccount,
  getConnectToken,
  requestAccountRevalidation,
  saveAccountSession,
  updateAccount,
} from "./accounts.service.js";

// There's no database-level tenant isolation (RLS) on Deploro's Studio DB — every "fetch a row I
// own" path is enforced purely in this service layer (findOwnedOrThrow-style checks). These tests
// exist as the compensating control: if a future change ever lets one user read/modify/delete
// another user's row, this suite fails instead of shipping the regression silently.

const studioGet = vi.fn();
const studioList = vi.fn();
const studioInsert = vi.fn();
const studioUpdate = vi.fn();
const studioDelete = vi.fn();

vi.mock("../../db/studio-client.js", () => ({
  studioGet: (...args: unknown[]) => studioGet(...args),
  studioList: (...args: unknown[]) => studioList(...args),
  studioListSorted: (...args: unknown[]) => studioList(...args),
  studioInsert: (...args: unknown[]) => studioInsert(...args),
  studioUpdate: (...args: unknown[]) => studioUpdate(...args),
  studioDelete: (...args: unknown[]) => studioDelete(...args),
}));

// The account's cooldown and session-check state live in Redis, and requesting a re-check enqueues
// BullMQ work. Mocked out here for the same reason the Studio client is: these tests are about the
// ownership checks, and importing the real modules would open a live Redis connection.
const queueAdd = vi.fn();
vi.mock("../../queue/queues.js", () => ({
  accountCheckQueue: { add: (...args: unknown[]) => queueAdd(...args) },
}));
vi.mock("../../queue/rate-limit/account-cooldown.js", () => ({
  getAccountCooldown: vi.fn(async () => null),
  getAccountCooldowns: vi.fn(async () => new Map()),
  clearAccountCooldown: vi.fn(async () => undefined),
}));
const setAccountSessionCheck = vi.fn();
vi.mock("./account-check.store.js", () => ({
  getAccountSessionCheck: vi.fn(async () => null),
  getAccountSessionChecks: vi.fn(async () => new Map()),
  setAccountSessionCheck: (...args: unknown[]) => setAccountSessionCheck(...args),
  clearAccountSessionCheck: vi.fn(async () => undefined),
}));

const OWNER = "owner-user-id";
const ATTACKER = "attacker-user-id";
const ACCOUNT_ID = "account-1";

const ownedAccount: XAccount = {
  id: ACCOUNT_ID,
  userId: OWNER,
  handle: "somehandle",
  encryptedSession: null,
  encryptedProxy: null,
  status: "active",
  dailyScrapeLimit: 150,
  maxConcurrency: 1,
  lastUsedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("accounts.service ownership isolation", () => {
  it("getAccount: owner can read their own account", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    const result = await getAccount(OWNER, ACCOUNT_ID);
    expect(result.id).toBe(ACCOUNT_ID);
  });

  it("getAccount: a different user gets NotFoundError instead of the row", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    await expect(getAccount(ATTACKER, ACCOUNT_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateAccount: a different user cannot update someone else's account", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    await expect(updateAccount(ATTACKER, ACCOUNT_ID, { dailyScrapeLimit: 999 })).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(studioUpdate).not.toHaveBeenCalled();
  });

  it("deleteAccount: a different user cannot delete someone else's account", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    await expect(deleteAccount(ATTACKER, ACCOUNT_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(studioDelete).not.toHaveBeenCalled();
  });

  it("getAccount: a nonexistent id gets NotFoundError, not a crash", async () => {
    studioGet.mockResolvedValue(null);
    await expect(getAccount(OWNER, "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("getConnectToken: a different user cannot mint a token for someone else's account", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    await expect(getConnectToken(ATTACKER, ACCOUNT_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("getConnectToken: the owner gets a token scoped to their own account", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    const result = await getConnectToken(OWNER, ACCOUNT_ID);
    expect(result.token).toEqual(expect.any(String));
    expect(result.expiresAt).toEqual(expect.any(String));
  });

  it("saveAccountSession: a different user's claimed userId cannot write another user's account", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    await expect(
      saveAccountSession(ATTACKER, ACCOUNT_ID, { storageState: {} })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(studioUpdate).not.toHaveBeenCalled();
  });

  it("saveAccountSession: the owner's session write updates the account and flips it active", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    studioUpdate.mockResolvedValue({ ...ownedAccount, status: "active", encryptedSession: "v1.a.b.c" });
    const result = await saveAccountSession(OWNER, ACCOUNT_ID, { storageState: { cookies: [] } });
    expect(result.hasSession).toBe(true);
    expect(studioUpdate).toHaveBeenCalledWith(
      "x_accounts",
      ACCOUNT_ID,
      expect.objectContaining({ status: "active" })
    );
  });

  it("requestAccountRevalidation: a different user cannot queue a check on someone else's account", async () => {
    studioGet.mockResolvedValue({ ...ownedAccount, status: "checkpointed", encryptedSession: "v1.a.b.c" });
    await expect(requestAccountRevalidation(ATTACKER, ACCOUNT_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

// A checkpoint must only ever be cleared by evidence, never by asking. These cover the request
// side of that: what it refuses outright, and that a permitted request only ever *queues* a check
// rather than changing the account's status itself.
describe("accounts.service session re-check", () => {
  const checkpointed: XAccount = { ...ownedAccount, status: "checkpointed", encryptedSession: "v1.a.b.c" };

  it("queues a check for a checkpointed account without touching its status", async () => {
    studioGet.mockResolvedValue(checkpointed);
    const result = await requestAccountRevalidation(OWNER, ACCOUNT_ID);

    expect(queueAdd).toHaveBeenCalledWith("check-session", { userId: OWNER, xAccountId: ACCOUNT_ID });
    expect(setAccountSessionCheck).toHaveBeenCalledWith(ACCOUNT_ID, expect.objectContaining({ state: "queued" }));
    // The verdict is the worker's to reach — asking for one changes nothing on its own.
    expect(studioUpdate).not.toHaveBeenCalled();
    expect(result.status).toBe("checkpointed");
    expect(result.sessionCheck?.state).toBe("queued");
  });

  it("refuses an account with no saved session — there is nothing to verify", async () => {
    studioGet.mockResolvedValue({ ...checkpointed, encryptedSession: null });
    await expect(requestAccountRevalidation(OWNER, ACCOUNT_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("refuses a banned account, which records a human decision rather than a tripped signal", async () => {
    studioGet.mockResolvedValue({ ...checkpointed, status: "banned" });
    await expect(requestAccountRevalidation(OWNER, ACCOUNT_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("still refuses a plain status flip back to active, re-check or not", async () => {
    studioGet.mockResolvedValue(checkpointed);
    await expect(updateAccount(OWNER, ACCOUNT_ID, { status: "active" })).rejects.toBeInstanceOf(ValidationError);
    expect(studioUpdate).not.toHaveBeenCalled();
  });
});
