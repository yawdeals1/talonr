import { beforeEach, describe, expect, it, vi } from "vitest";

const studio = vi.hoisted(() => ({ studioGet: vi.fn() }));
vi.mock("../../db/studio-client.js", () => studio);

const results = vi.hoisted(() => ({ isScrapeFinishRequested: vi.fn() }));
vi.mock("./scrape-results.service.js", () => results);

const { CANCELLED_ERROR_MESSAGE, createRunCheckpoint, describeRunLimitStop, isCancelledJob, withRunDeadline } =
  await import("./scrape-cancel.js");
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

describe("withRunDeadline", () => {
  const never = () => Promise.resolve("continue" as const);

  it("lets a run carry on while it still has time", async () => {
    const checkpoint = withRunDeadline(never, Date.now() + 60_000);
    await expect(checkpoint()).resolves.toBe("continue");
  });

  it("asks the run to wrap up once the clock runs out", async () => {
    const checkpoint = withRunDeadline(never, Date.now() - 1);
    await expect(checkpoint()).resolves.toBe("finish");
  });

  it("reports the expiry exactly once, however often it is asked", async () => {
    const onExpire = vi.fn();
    const checkpoint = withRunDeadline(never, Date.now() - 1, onExpire);

    await checkpoint();
    await checkpoint();
    await checkpoint();

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("lets a cancellation through instead of swallowing it as a timeout", async () => {
    // The user stopped this run; it must be recorded as cancelled even though the clock had also
    // run out, so the wrapped checkpoint is asked before the deadline is consulted.
    const onExpire = vi.fn();
    const cancelling = () => Promise.reject(new ScrapeCancelledError());
    const checkpoint = withRunDeadline(cancelling, Date.now() - 1, onExpire);

    await expect(checkpoint()).rejects.toBeInstanceOf(ScrapeCancelledError);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("does not claim a timeout when the user asked the run to finish", async () => {
    const onExpire = vi.fn();
    const finishing = () => Promise.resolve("finish" as const);
    const checkpoint = withRunDeadline(finishing, Date.now() - 1, onExpire);

    await expect(checkpoint()).resolves.toBe("finish");
    expect(onExpire).not.toHaveBeenCalled();
  });
});

describe("describeRunLimitStop", () => {
  const base = { budgetMinutes: 20, leadsFound: 20, capLeads: 20, unenriched: 0 };

  it("says nothing when the clock cost the run nothing", () => {
    expect(describeRunLimitStop(base)).toBeNull();
  });

  it("reports a run that ran out of time before it hit the cap", () => {
    const note = describeRunLimitStop({ ...base, leadsFound: 6 });
    expect(note).toContain("6 of the 20 leads requested");
    expect(note).toContain("20-minute run limit");
  });

  it("reports leads saved without profile details even when the count looks complete", () => {
    // The case the saved count hides: an unfiltered run keeps everything it collected, so a clock
    // that beat the profile pass still reports a full cap — while most of those rows have no
    // follower count and are invisible to every follower-range filter.
    const note = describeRunLimitStop({ ...base, leadsFound: 1000, capLeads: 1000, unenriched: 850 });
    expect(note).not.toBeNull();
    expect(note).toContain("850 of them");
    expect(note).toContain("no follower count or location");
  });

  it("does not read as though one lead were several", () => {
    expect(describeRunLimitStop({ ...base, leadsFound: 1, capLeads: 1, unenriched: 1 })).toContain(
      "1 lead saved, 1 of it"
    );
  });
});
