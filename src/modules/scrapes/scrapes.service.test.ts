import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead, LeadList, ScrapeJob, XAccount } from "../../db/schema.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import {
  cancelScrapeJob,
  createScrapeJob,
  deleteScrapeJob,
  deleteScrapeJobs,
  getScrapeJob,
  listScrapeJobLeads,
  updateScrapeResultFilter,
} from "./scrapes.service.js";
import { CANCELLED_ERROR_MESSAGE, isCancelledJob } from "./scrape-cancel.js";

// Compensating control for the lack of database-level tenant isolation (see
// accounts.service.test.ts for the full rationale) — this file covers scrapes.service.ts's own
// ownership checks, including that a scrape can only be triggered against an x_account the
// caller actually owns.

const studioGet = vi.fn();
const studioInsert = vi.fn();
const studioUpdate = vi.fn();
const studioDelete = vi.fn();
const studioList = vi.fn();
const studioListSorted = vi.fn();
const queueAdd = vi.fn();
const queueGetJob = vi.fn();

vi.mock("../../db/studio-client.js", () => ({
  studioGet: (...args: unknown[]) => studioGet(...args),
  studioList: (...args: unknown[]) => studioList(...args),
  studioListSorted: (...args: unknown[]) => studioListSorted(...args),
  studioInsert: (...args: unknown[]) => studioInsert(...args),
  studioUpdate: (...args: unknown[]) => studioUpdate(...args),
  studioDelete: (...args: unknown[]) => studioDelete(...args),
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
  engagementTypes: null,
  resultFilterDefinition: {},
  tracksExactLeads: true,
  status: "queued",
  leadsFound: 0,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const resultStore: LeadList = {
  id: "result-store-1",
  userId: OWNER,
  name: `__talonr_scrape__:${JOB_ID}`,
  filterDefinition: {
    internalScrapeResult: true,
    scrapeJobId: JOB_ID,
    leadIds: [],
  } as LeadList["filterDefinition"],
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  studioList.mockResolvedValue({ rows: [], total: 0 });
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
    studioInsert.mockImplementation(async (table: string) => (table === "scrape_jobs" ? ownedJob : resultStore));
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

  it("createScrapeJob: stores the legacy enum value but queues the real engagement strategy", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    studioInsert.mockImplementation(async (table: string) =>
      table === "scrape_jobs" ? { ...ownedJob, sourceType: "engagers" } : resultStore
    );

    await createScrapeJob(OWNER, {
      xAccountId: ACCOUNT_ID,
      sourceType: "engagers",
      sourceRef: "https://x.com/example/status/123",
      engagementTypes: ["retweeters"],
      capLeads: 15,
    });

    expect(studioInsert).toHaveBeenCalledWith("scrape_jobs", {
      userId: OWNER,
      xAccountId: ACCOUNT_ID,
      sourceType: "likers",
      sourceRef: "https://x.com/example/status/123",
      status: "queued",
    });
    expect(queueAdd).toHaveBeenCalledWith(
      "scrape",
      expect.objectContaining({ engagementTypes: ["retweeters"], capLeads: 15 }),
      expect.any(Object)
    );
  });

  it("createScrapeJob: persists optional result filters in its hidden exact-result store", async () => {
    studioGet.mockResolvedValue(ownedAccount);
    studioInsert.mockImplementation(async (table: string) => (table === "scrape_jobs" ? ownedJob : resultStore));

    await createScrapeJob(OWNER, {
      xAccountId: ACCOUNT_ID,
      sourceType: "search",
      sourceRef: "keyword",
      resultFilterDefinition: { maxFollowers: 2_000, location: "Ghana" },
    });

    expect(studioInsert).toHaveBeenCalledWith(
      "lead_lists",
      expect.objectContaining({
        userId: OWNER,
        filterDefinition: expect.objectContaining({
          internalScrapeResult: true,
          scrapeJobId: JOB_ID,
          leadIds: [],
          maxFollowers: 2_000,
          location: "Ghana",
        }),
      })
    );
  });

  it("createScrapeJob: hands the result filter to the worker so the run aims for matching leads", async () => {
    // Without this the filter only ever hid rows after the fact: the run still spent its whole
    // lead cap on the first accounts in the list, so a narrow range came back nearly empty.
    studioGet.mockResolvedValue(ownedAccount);
    studioInsert.mockImplementation(async (table: string) => (table === "scrape_jobs" ? ownedJob : resultStore));

    await createScrapeJob(OWNER, {
      xAccountId: ACCOUNT_ID,
      sourceType: "search",
      sourceRef: "keyword",
      capLeads: 10,
      resultFilterDefinition: { minFollowers: 100, maxFollowers: 2_000 },
    });

    expect(queueAdd).toHaveBeenCalledWith(
      "scrape",
      expect.objectContaining({
        capLeads: 10,
        resultFilter: { minFollowers: 100, maxFollowers: 2_000 },
      }),
      { jobId: JOB_ID }
    );
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

  it("cancelScrapeJob: stops a running job by marking the row, without touching its queue entry", async () => {
    // The Playwright run lives in the worker process, so the API can't kill it directly: it writes
    // the cancelled row and the worker stops itself at its next checkpoint. Removing the BullMQ
    // entry here would throw — an active job's lock belongs to the worker holding it.
    const getState = vi.fn().mockResolvedValue("active");
    const remove = vi.fn().mockResolvedValue(undefined);
    studioGet.mockResolvedValue({ ...ownedJob, status: "running" });
    queueGetJob.mockResolvedValue({ getState, remove });
    studioUpdate.mockResolvedValue({ ...ownedJob, status: "failed", errorMessage: CANCELLED_ERROR_MESSAGE });
    studioInsert.mockResolvedValue({});

    const result = await cancelScrapeJob(OWNER, JOB_ID);

    expect(remove).not.toHaveBeenCalled();
    expect(studioUpdate).toHaveBeenCalledWith(
      "scrape_jobs",
      JOB_ID,
      expect.objectContaining({ status: "failed", errorMessage: CANCELLED_ERROR_MESSAGE })
    );
    expect(isCancelledJob(result)).toBe(true);
  });

  it("cancelScrapeJob: takes a not-yet-started job off the queue as well", async () => {
    const getState = vi.fn().mockResolvedValue("waiting");
    const remove = vi.fn().mockResolvedValue(undefined);
    studioGet.mockResolvedValue(ownedJob);
    queueGetJob.mockResolvedValue({ getState, remove });
    studioUpdate.mockResolvedValue({ ...ownedJob, status: "failed", errorMessage: CANCELLED_ERROR_MESSAGE });
    studioInsert.mockResolvedValue({});

    await cancelScrapeJob(OWNER, JOB_ID);

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("cancelScrapeJob: refuses a job that has already finished", async () => {
    studioGet.mockResolvedValue({ ...ownedJob, status: "completed" });
    await expect(cancelScrapeJob(OWNER, JOB_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(studioUpdate).not.toHaveBeenCalled();
  });

  it("deleteScrapeJob: a different user cannot delete someone else's job", async () => {
    studioGet.mockResolvedValue(ownedJob);
    await expect(deleteScrapeJob(ATTACKER, JOB_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(queueGetJob).not.toHaveBeenCalled();
    expect(studioDelete).not.toHaveBeenCalled();
  });

  it("deleteScrapeJob: refuses to delete a running job", async () => {
    studioGet.mockResolvedValue({ ...ownedJob, status: "running" });
    await expect(deleteScrapeJob(OWNER, JOB_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(queueGetJob).not.toHaveBeenCalled();
    expect(studioDelete).not.toHaveBeenCalled();
  });

  it("deleteScrapeJob: removes a terminal queue job and the owner's scrape record", async () => {
    const getState = vi.fn().mockResolvedValue("completed");
    const remove = vi.fn().mockResolvedValue(undefined);
    studioGet.mockResolvedValue({ ...ownedJob, status: "completed" });
    queueGetJob.mockResolvedValue({ getState, remove });

    await deleteScrapeJob(OWNER, JOB_ID);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(studioDelete).toHaveBeenCalledWith("scrape_jobs", JOB_ID);
  });

  it("deleteScrapeJobs: checks ownership before any bulk queue or database deletion", async () => {
    studioGet.mockResolvedValue(ownedJob);

    await expect(deleteScrapeJobs(ATTACKER, [JOB_ID])).rejects.toBeInstanceOf(NotFoundError);

    expect(queueGetJob).not.toHaveBeenCalled();
    expect(studioDelete).not.toHaveBeenCalled();
  });
});

describe("scrape-specific lead membership", () => {
  const lead = (id: string, followers: number): Lead => ({
    id,
    userId: OWNER,
    handle: id,
    displayName: id,
    bio: null,
    followers,
    location: "Accra, Ghana",
    verified: false,
    profileImage: null,
    sourceType: "search",
    sourceRef: "keyword",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
  });

  it("returns only exact job members that match the persisted follower filter", async () => {
    studioGet
      .mockResolvedValueOnce({ ...ownedJob, resultFilterDefinition: { maxFollowers: 2_000 } })
      .mockResolvedValueOnce(lead("qualified", 1_500))
      .mockResolvedValueOnce(lead("too-large", 50_000));
    studioList.mockResolvedValue({
      rows: [
        {
          ...resultStore,
          filterDefinition: {
            internalScrapeResult: true,
            scrapeJobId: JOB_ID,
            leadIds: ["qualified", "too-large"],
            maxFollowers: 2_000,
          },
        },
      ],
      total: 1,
    });

    const result = await listScrapeJobLeads(OWNER, JOB_ID);

    expect(result.leads.map((row) => row.id)).toEqual(["qualified"]);
    expect(result.total).toBe(1);
    expect(result.exactMembershipAvailable).toBe(true);
  });

  it("does not approximate membership for jobs created before exact tracking", async () => {
    studioGet.mockResolvedValue({ ...ownedJob, tracksExactLeads: false });

    const result = await listScrapeJobLeads(OWNER, JOB_ID);

    expect(result.leads).toEqual([]);
    expect(result.exactMembershipAvailable).toBe(false);
    expect(studioListSorted).not.toHaveBeenCalled();
  });

  it("does not allow another user to change a scrape's persisted filter", async () => {
    studioGet.mockResolvedValue(ownedJob);

    await expect(updateScrapeResultFilter(ATTACKER, JOB_ID, { maxFollowers: 2_000 })).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(studioUpdate).not.toHaveBeenCalled();
  });
});
