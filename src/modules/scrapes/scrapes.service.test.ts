import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeJob, XAccount } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";
import { cancelScrapeJob, createScrapeJob, getScrapeJob } from "./scrapes.service.js";

// Compensating control for the lack of database-level tenant isolation (see
// accounts.service.test.ts for the full rationale) — this file covers scrapes.service.ts's own
// ownership checks, including that a scrape can only be triggered against an x_account the
// caller actually owns.

const studioGet = vi.fn();
const studioInsert = vi.fn();
const studioTableHasColumn = vi.fn();
const studioUpdate = vi.fn();
const queueAdd = vi.fn();
const queueGetJob = vi.fn();

vi.mock("../../db/studio-client.js", () => ({
  studioGet: (...args: unknown[]) => studioGet(...args),
  studioListSorted: vi.fn(),
  studioInsert: (...args: unknown[]) => studioInsert(...args),
  studioTableHasColumn: (...args: unknown[]) => studioTableHasColumn(...args),
  studioUpdate: (...args: unknown[]) => studioUpdate(...args),
}));

vi.mock("../../queue/queues.js", () => ({
  scrapeQueue: {
    add: (...args: unknown[]) => queueAdd(...args),
    getJob: (...args: unknown[]) => queueGetJob(...args),
  },
}));

const OWNER = "owner-user-id";
const ATTACKER = "attacker-user-id";
const ACCOUNT_ID = "account-1";
const JOB_ID = "job-1";

const ownedAccount: XAccount = {
  id: ACCOUNT_ID,
  userId: OWNER,
  handle: "somehandle",
  encryptedSession: "v1.iv.tag.ct",
  encryptedProxy: null,
  status: "active",
  dailyScrapeLimit: 150,
  maxConcurrency: 1,
  lastUsedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const ownedJob: ScrapeJob = {
  id: JOB_ID,
  userId: OWNER,
  xAccountId: ACCOUNT_ID,
  sourceType: "search",
  sourceRef: "keyword",
  status: "queued",
  leadsFound: 0,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  studioTableHasColumn.mockResolvedValue(false);
});

describe("scrapes.service ownership isolation", () => {
  it("createScrapeJob: cannot trigger a scrape against another user's x_account", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    await expect(
      createScrapeJob(ATTACKER, { xAccountId: ACCOUNT_ID, sourceType: "search", sourceRef: "keyword" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(studioInsert).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("createScrapeJob: the owner can trigger a scrape against their own active x_account", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    studioInsert.mockResolvedValue(ownedJob);
    const result = await createScrapeJob(OWNER, {
      xAccountId: ACCOUNT_ID,
      sourceType: "search",
      sourceRef: "keyword",
    });
    expect(result.id).toBe(JOB_ID);
    expect(studioInsert).toHaveBeenCalledWith("scrape_jobs", {
      userId: OWNER,
      xAccountId: ACCOUNT_ID,
      sourceType: "search",
      sourceRef: "keyword",
      status: "queued",
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it("createScrapeJob: queues engagement strategies when the optional Studio column is absent", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    studioInsert.mockResolvedValue({ ...ownedJob, sourceType: "engagers" });

    await createScrapeJob(OWNER, {
      xAccountId: ACCOUNT_ID,
      sourceType: "engagers",
      sourceRef: "https://x.com/example/status/123",
      engagementTypes: ["retweeters"],
      capLeads: 15,
    });

    expect(studioInsert).toHaveBeenCalledWith(
      "scrape_jobs",
      expect.not.objectContaining({ engagementTypes: expect.anything() })
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "scrape",
      expect.objectContaining({ engagementTypes: ["retweeters"], capLeads: 15 }),
      expect.any(Object)
    );
  });

  it("createScrapeJob: persists engagement strategies when the Studio column is available", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    studioTableHasColumn.mockResolvedValue(true);
    studioInsert.mockResolvedValue({ ...ownedJob, sourceType: "engagers", engagementTypes: ["retweeters"] });

    await createScrapeJob(OWNER, {
      xAccountId: ACCOUNT_ID,
      sourceType: "engagers",
      sourceRef: "https://x.com/example/status/123",
      engagementTypes: ["retweeters"],
    });

    expect(studioInsert).toHaveBeenCalledWith(
      "scrape_jobs",
      expect.objectContaining({ engagementTypes: ["retweeters"] })
    );
  });

  it("createScrapeJob: still creates the job when the optional schema lookup fails", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    studioTableHasColumn.mockRejectedValue(new Error("spec unavailable"));
    studioInsert.mockResolvedValue(ownedJob);

    await createScrapeJob(OWNER, {
      xAccountId: ACCOUNT_ID,
      sourceType: "search",
      sourceRef: "keyword",
    });

    expect(studioInsert).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it("getScrapeJob: a different user gets NotFoundError instead of the row", async () => {
    studioGet.mockResolvedValue(ownedJob);
    await expect(getScrapeJob(ATTACKER, JOB_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cancelScrapeJob: a different user cannot cancel someone else's job", async () => {
    studioGet.mockResolvedValue(ownedJob);
    await expect(cancelScrapeJob(ATTACKER, JOB_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(queueGetJob).not.toHaveBeenCalled();
    expect(studioUpdate).not.toHaveBeenCalled();
  });
});
