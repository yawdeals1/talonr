import { beforeEach, describe, expect, it, vi } from "vitest";

const studio = vi.hoisted(() => ({ studioGet: vi.fn() }));
vi.mock("../../db/studio-client.js", () => studio);

const results = vi.hoisted(() => ({ isScrapeFinishRequested: vi.fn() }));
vi.mock("./scrape-results.service.js", () => results);

const { CANCELLED_ERROR_MESSAGE, createRunCheckpoint, isCancelledJob } = await import("./scrape-cancel.js");
const { ScrapeCancelledError } = await import("../../scraper/types.js");

const runningJob = { status: "running", errorMessage: null } as const;
const cancelledJob = { status: "failed", errorMessage: CANCELLED_ERROR_MESSAGE } as const;

const checkpointFor = () => createRunCheckpoint("user-1", "job-1");

beforeEach(() => {
  vi.clearAllMocks();
  results.isScrapeFinishRequested.mockResolvedValue(false);
});

describe("isCancelledJob", () => {
  it("distinguishes a cancelled run from a genuinely failed one", () => {
    expect(isCancelledJob(cancelledJob)).toBe(true);
    expect(isCancelledJob(runningJob)).toBe(false);
    expect(isCancelledJob({ status: "failed", errorMessage: "net::ERR_ABORTED" })).toBe(false);
    expect(isCancelledJob({ status: "completed", errorMessage: null })).toBe(false);
  });
});

describe("createRunCheckpoint", () => {
  it("lets a wanted run carry on", async () => {
    studio.studioGet.mockResolvedValue(runningJob);
    await expect(checkpointFor()()).resolves.toBe("continue");
  });

  it("throws once the job row is marked cancelled", async () => {
    studio.studioGet.mockResolvedValue(cancelledJob);
    await expect(checkpointFor()()).rejects.toBeInstanceOf(ScrapeCancelledError);
  });

  it("treats a deleted job row as a cancellation", async () => {
    studio.studioGet.mockResolvedValue(null);
    await expect(checkpointFor()()).rejects.toBeInstanceOf(ScrapeCancelledError);
  });

  it("keeps throwing without re-reading once it has seen the cancellation", async () => {
    studio.studioGet.mockResolvedValue(cancelledJob);
    const checkpoint = checkpointFor();

    await expect(checkpoint()).rejects.toBeInstanceOf(ScrapeCancelledError);
    await expect(checkpoint()).rejects.toBeInstanceOf(ScrapeCancelledError);
    expect(studio.studioGet).toHaveBeenCalledTimes(1);
  });

  it("reports a finish request, and keeps reporting it without re-reading", async () => {
    studio.studioGet.mockResolvedValue(runningJob);
    results.isScrapeFinishRequested.mockResolvedValue(true);
    const checkpoint = checkpointFor();

    await expect(checkpoint()).resolves.toBe("finish");
    await expect(checkpoint()).resolves.toBe("finish");
    expect(studio.studioGet).toHaveBeenCalledTimes(1);
  });

  it("prefers a cancellation over a finish request", async () => {
    // Both can be true at once — the user asks to wrap up, then decides to stop outright.
    studio.studioGet.mockResolvedValue(cancelledJob);
    results.isScrapeFinishRequested.mockResolvedValue(true);
    await expect(checkpointFor()()).rejects.toBeInstanceOf(ScrapeCancelledError);
  });

  it("throttles reads so a long run doesn't poll on every scroll round", async () => {
    studio.studioGet.mockResolvedValue(runningJob);
    const checkpoint = checkpointFor();

    await checkpoint();
    await checkpoint();
    await checkpoint();

    expect(studio.studioGet).toHaveBeenCalledTimes(1);
  });

  it("lets the run continue when the check itself fails", async () => {
    // A Studio hiccup must not kill a healthy scrape — the next checkpoint tries again.
    studio.studioGet.mockRejectedValue(new Error("studio unavailable"));
    await expect(checkpointFor()()).resolves.toBe("continue");
  });
});
