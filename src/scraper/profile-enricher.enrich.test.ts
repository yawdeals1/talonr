import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { getPartialLeads, ScrapeCancelledError, type RawLead } from "./types.js";

const detectors = vi.hoisted(() => ({
  checkHealth: vi.fn(async () => undefined),
  watchForRateLimitResponses: vi.fn(() => () => undefined),
}));
vi.mock("./detectors.js", () => detectors);

const { enrichLeadsFromProfiles } = await import("./profile-enricher.js");

interface FakeProfile {
  followersCandidates?: string[];
  bio?: string | null;
  location?: string | null;
}

/**
 * Stands in for a Playwright page: `goto` records which profile is "open", `evaluate` answers with
 * that profile's scripted details. Each handle can queue several responses so a test can make the
 * first visit come back unhydrated and the retry come back complete.
 */
function fakePage(profiles: Record<string, FakeProfile[]>) {
  let current = "";
  const visits: string[] = [];

  const page = {
    goto: vi.fn(async (url: string) => {
      current = decodeURIComponent(new URL(url).pathname.slice(1));
      visits.push(current);
    }),
    waitForSelector: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => {
      const queued = profiles[current] ?? [];
      const details = queued.length > 1 ? queued.shift()! : (queued[0] ?? {});
      return {
        displayName: null,
        bio: details.bio ?? null,
        followersCandidates: details.followersCandidates ?? [],
        location: details.location ?? null,
        verified: false,
        profileImage: null,
      };
    }),
  };

  return { page: page as unknown as Page, visits };
}

function rawLead(handle: string): RawLead {
  return {
    handle,
    displayName: handle,
    bio: null,
    followers: null,
    location: null,
    verified: false,
    profileImage: null,
  };
}

const noDelay = { minDelayMs: 0, maxDelayMs: 0 };

beforeEach(() => {
  detectors.checkHealth.mockClear();
});

describe("enrichLeadsFromProfiles", () => {
  it("merges the exact follower count off the stats link", async () => {
    const { page } = fakePage({
      bigaccount: [{ followersCandidates: ["51,132", "51.1K Followers"], bio: "Dev", location: "Accra" }],
    });

    const [lead] = await enrichLeadsFromProfiles(page, [rawLead("bigaccount")], noDelay);

    expect(lead).toMatchObject({ followers: 51_132, bio: "Dev", location: "Accra" });
  });

  it("retries once when the profile header came back without a follower count", async () => {
    // X's profile header hydrates after domcontentloaded. A lead whose count stayed null is
    // invisible to every follower-range filter, so it's worth one reload before giving up.
    const { page, visits } = fakePage({
      slowaccount: [{}, { followersCandidates: ["1,240 Followers"], bio: "Late bio" }],
    });

    const [lead] = await enrichLeadsFromProfiles(page, [rawLead("slowaccount")], noDelay);

    expect(visits).toEqual(["slowaccount", "slowaccount"]);
    expect(lead).toMatchObject({ followers: 1_240, bio: "Late bio" });
  });

  it("keeps the list-view lead when both attempts fail", async () => {
    const { page, visits } = fakePage({});
    (page.goto as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("net::ERR_ABORTED"));

    const [lead] = await enrichLeadsFromProfiles(page, [rawLead("gone")], noDelay);

    expect(visits).toEqual([]);
    expect(lead).toMatchObject({ handle: "gone", followers: null });
  });

  it("stops as soon as it has enough matching leads, and keeps the non-matching ones it visited", async () => {
    // The point of a follower range on a scrape: keep checking candidates until the run has a full
    // cap of accounts inside the range, rather than filtering the first N in the list down to two.
    const { page, visits } = fakePage({
      tiny1: [{ followersCandidates: ["2 Followers"] }],
      good1: [{ followersCandidates: ["235 Followers"] }],
      tiny2: [{ followersCandidates: ["1 Followers"] }],
      good2: [{ followersCandidates: ["1,500 Followers"] }],
      never: [{ followersCandidates: ["900 Followers"] }],
    });

    const enriched = await enrichLeadsFromProfiles(
      page,
      ["tiny1", "good1", "tiny2", "good2", "never"].map(rawLead),
      {
        ...noDelay,
        target: {
          count: 2,
          matches: (lead) => lead.followers !== null && lead.followers >= 100 && lead.followers <= 2000,
        },
      }
    );

    expect(visits).toEqual(["tiny1", "good1", "tiny2", "good2"]);
    expect(enriched.map((lead) => lead.handle)).toEqual(["tiny1", "good1", "tiny2", "good2"]);
    expect(enriched.filter((lead) => lead.followers! >= 100 && lead.followers! <= 2000)).toHaveLength(2);
  });

  it("stops on cancellation and carries the already-enriched leads out on the error", async () => {
    // A cancelled run must keep its work: the worker saves these partials before marking the job
    // cancelled, so stopping a long scrape doesn't throw away what it had already collected.
    const { page, visits } = fakePage({
      a: [{ followersCandidates: ["10 Followers"] }],
      b: [{ followersCandidates: ["20 Followers"] }],
      c: [{ followersCandidates: ["30 Followers"] }],
    });
    let visitsBeforeCancel = 2;

    const promise = enrichLeadsFromProfiles(page, ["a", "b", "c"].map(rawLead), {
      ...noDelay,
      shouldCancel: async () => {
        if (visitsBeforeCancel-- <= 0) throw new ScrapeCancelledError();
      },
    });

    await expect(promise).rejects.toBeInstanceOf(ScrapeCancelledError);
    expect(visits).toEqual(["a", "b"]);
    await promise.catch((err: unknown) => {
      expect(getPartialLeads(err).map((lead) => lead.handle)).toEqual(["a", "b"]);
    });
  });

  it("visits every lead when the job carries no filter", async () => {
    const { page, visits } = fakePage({
      a: [{ followersCandidates: ["10 Followers"] }],
      b: [{ followersCandidates: ["20 Followers"] }],
      c: [{ followersCandidates: ["30 Followers"] }],
    });

    const enriched = await enrichLeadsFromProfiles(page, ["a", "b", "c"].map(rawLead), noDelay);

    expect(visits).toEqual(["a", "b", "c"]);
    expect(enriched).toHaveLength(3);
  });
});
