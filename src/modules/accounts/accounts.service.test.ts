import { beforeEach, describe, expect, it, vi } from "vitest";
import type { XAccount } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";
import { deleteAccount, getAccount, updateAccount } from "./accounts.service.js";

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
});
