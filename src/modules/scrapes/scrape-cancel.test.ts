import { beforeEach, describe, expect, it, vi } from "vitest";

const studio = vi.hoisted(() => ({ studioGet: vi.fn() }));
vi.mock("../../db/studio-client.js", () => studio);

const results = vi.hoisted(() => ({ isScrapeFinishRequested: vi.fn(), isScrapePauseRequested: vi.fn() }));
vi.mock("./scrape-results.service.js", () => results);

const { CANCELLED_ERROR_MESSAGE, createRunCheckpoint, describeScrapeOutcome, isCancelledJob, withRunDeadline } =
  await import("./scrape-cancel.js");
const { ScrapeCancelledError } = await import("../../scraper/types.js");

const runningJob = { status: "running", errorMessage: null } as const;
const cancelledJob = { status: "failed", errorMessage: CANCELLED_ERROR_MESSAGE } as const;

const checkpointFor = () => createRunCheckpoint("user-1", "job-1");

beforeEach(() => {
  vi.clearAllMocks();
  results.isScrapeFinishRequested.mockResolvedValue(false);
  results.isScrapePauseRequested.mockResolvedValue(false);
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

  it("reports a pause request, which stops the run without ending the job", async () => {
    // The third way a run can stop: the leads are kept exactly as "Finish now" keeps them, but the
    // job stays resumable rather than completing.
    studio.studioGet.mockResolvedValue(runningJob);
    results.isScrapePauseRequested.mockResolvedValue(true);

    const checkpoint = checkpointFor();
    await expect(checkpoint()).resolves.toBe("pause");
    await expect(checkpoint()).resolves.toBe("pause");
    expect(studio.studioGet).toHaveBeenCalledTimes(1);
  });

  it("prefers a pause over a finish when both rows somehow exist", async () => {
    // Pause is the recoverable ending, so an ambiguous state resolves to the one that loses less.
    studio.studioGet.mockResolvedValue(runningJob);
    results.isScrapePauseRequested.mockResolvedValue(true);
    results.isScrapeFinishRequested.mockResolvedValue(true);

    await expect(checkpointFor()()).resolves.toBe("pause");
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

describe("describeScrapeOutcome", () => {
  const base = {
    capLeads: 20,
    leadsFound: 20,
    collected: 20,
    checked: 20,
    skipped: 0,
    collectionReason: "cap" as const,
    filtered: false,
    timedOut: false,
    budgetMinutes: 20,
    unenriched: 0,
  };

  it("says nothing when the run delivered what it was asked for", () => {
    expect(describeScrapeOutcome(base)).toBeNull();
  });

  it("names the end of the list, which used to complete green and silent", () => {
    // The failure this whole function exists for: a followers scrape asked for 100 that read five
    // accounts and stopped said nothing at all, so there was no way to tell it from a target that
    // genuinely only had five.
    const note = describeScrapeOutcome({
      ...base,
      leadsFound: 5,
      collected: 5,
      checked: 5,
      collectionReason: "exhausted",
    });

    expect(note).toContain("Reached the end of the list after 5 accounts");
    expect(note).toContain("5 leads");
  });

  it("distinguishes X refusing to serve more from the list having ended", () => {
    const note = describeScrapeOutcome({
      ...base,
      leadsFound: 5,
      collected: 40,
      checked: 5,
      collectionReason: "stalled",
    });

    expect(note).toContain("X stopped serving more of the list after 40 accounts");
    expect(note).toContain("Run it again later");
  });

  it("separates profiles checked from leads matched on a filtered run", () => {
    const note = describeScrapeOutcome({
      ...base,
      leadsFound: 4,
      collected: 100,
      checked: 100,
      filtered: true,
    });

    expect(note).toContain("100 profiles checked, 4 matched your filter");
  });

  it("says what a continued run scrolled past", () => {
    const note = describeScrapeOutcome({
      ...base,
      leadsFound: 2,
      collected: 2,
      checked: 2,
      skipped: 340,
      collectionReason: "exhausted",
    });

    expect(note).toContain("340 accounts already collected by an earlier run");
  });

  it("still reports the clock when that is what stopped the run", () => {
    const note = describeScrapeOutcome({ ...base, leadsFound: 6, timedOut: true });
    expect(note).toContain("20-minute run limit");
    expect(note).toContain("6 leads of the 20 requested");
  });

  it("reports leads saved without profile details even when the count looks complete", () => {
    // The case the saved count hides: an unfiltered run keeps everything it collected, so a clock
    // that beat the profile pass still reports a full cap — while most of those rows have no
    // follower count and are invisible to every follower-range filter.
    const note = describeScrapeOutcome({
      ...base,
      capLeads: 1000,
      leadsFound: 1000,
      collected: 1000,
      checked: 150,
      unenriched: 850,
      timedOut: true,
    });

    expect(note).not.toBeNull();
    expect(note).toContain("850 leads were saved straight off the list");
    expect(note).toContain("no follower count or location");
  });

  it("does not read as though one lead were several", () => {
    const note = describeScrapeOutcome({
      ...base,
      capLeads: 1,
      leadsFound: 1,
      collected: 1,
      checked: 1,
      unenriched: 1,
      timedOut: true,
    });

    expect(note).toContain("1 lead was saved straight off the list");
  });
});
