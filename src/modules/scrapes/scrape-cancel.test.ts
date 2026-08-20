import { beforeEach, describe, expect, it, vi } from "vitest";

const studio = vi.hoisted(() => ({ studioGet: vi.fn() }));
vi.mock("../../db/studio-client.js", () => studio);

const { CANCELLED_ERROR_MESSAGE, createCancellationCheck, isCancelledJob } = await import("./scrape-cancel.js");
const { ScrapeCancelledError } = await import("../../scraper/types.js");

const runningJob = { status: "running", errorMessage: null } as const;
const cancelledJob = { status: "failed", errorMessage: CANCELLED_ERROR_MESSAGE } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("isCancelledJob", () => {
  it("distinguishes a cancelled run from a genuinely failed one", () => {
    expect(isCancelledJob(cancelledJob)).toBe(true);
    expect(isCancelledJob(runningJob)).toBe(false);
    expect(isCancelledJob({ status: "failed", errorMessage: "net::ERR_ABORTED" })).toBe(false);
    expect(isCancelledJob({ status: "completed", errorMessage: null })).toBe(false);
  });
});

describe("createCancellationCheck", () => {
  it("passes while the job is still wanted", async () => {
    studio.studioGet.mockResolvedValue(runningJob);
    await expect(createCancellationCheck("job-1")()).resolves.toBeUndefined();
  });

  it("throws once the job row is marked cancelled", async () => {
    studio.studioGet.mockResolvedValue(cancelledJob);
    await expect(createCancellationCheck("job-1")()).rejects.toBeInstanceOf(ScrapeCancelledError);
  });

  it("treats a deleted job row as a cancellation", async () => {
    studio.studioGet.mockResolvedValue(null);
    await expect(createCancellationCheck("job-1")()).rejects.toBeInstanceOf(ScrapeCancelledError);
  });

  it("keeps throwing without re-reading once it has seen the cancellation", async () => {
    studio.studioGet.mockResolvedValue(cancelledJob);
    const shouldCancel = createCancellationCheck("job-1");

    await expect(shouldCancel()).rejects.toBeInstanceOf(ScrapeCancelledError);
    await expect(shouldCancel()).rejects.toBeInstanceOf(ScrapeCancelledError);
    expect(studio.studioGet).toHaveBeenCalledTimes(1);
  });

  it("throttles reads so a long run doesn't poll on every scroll round", async () => {
    studio.studioGet.mockResolvedValue(runningJob);
    const shouldCancel = createCancellationCheck("job-1");

    await shouldCancel();
    await shouldCancel();
    await shouldCancel();

    expect(studio.studioGet).toHaveBeenCalledTimes(1);
  });

  it("lets the run continue when the check itself fails", async () => {
    // A Studio hiccup must not kill a healthy scrape — the next checkpoint tries again.
    studio.studioGet.mockRejectedValue(new Error("studio unavailable"));
    await expect(createCancellationCheck("job-1")()).resolves.toBeUndefined();
  });
});
