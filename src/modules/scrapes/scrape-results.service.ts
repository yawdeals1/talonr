import { studioDelete, studioInsert, studioList, studioUpdate } from "../../db/studio-client.js";
import type { LeadList, ScrapeJob, ScrapeResultFilter } from "../../db/schema.js";

const RESULT_STORE_PREFIX = "__talonr_scrape__:";
// A "wrap up now" request lives in its own row rather than in the result store above, so the two
// writers never collide: the API only ever creates this row, the worker only ever reads and
// deletes it. The store itself is written continuously by the running worker (lead ids, progress),
// and `filter_definition` is a single JSONB column — a PATCH rewrites all of it, so a flag written
// into it by the API could be clobbered by the worker's next progress write.
const FINISH_REQUEST_PREFIX = "__talonr_scrape_finish__:";
// "Pause" is the same kind of out-of-band request as "finish" and lives in its own row for the same
// reason. It is a separate row rather than a flag on the finish row because the two endings differ —
// a finished job is done, a paused one is resumable — and a user who asked for one should never get
// the other because a shared row was half-written.
const PAUSE_REQUEST_PREFIX = "__talonr_scrape_pause__:";

/**
 * Live progress of a run, refreshed by the worker as it goes so the job page can show what's
 * happening instead of nothing until the whole scrape ends.
 */
export interface ScrapeProgress {
  phase: "collecting" | "checking";
  /** Handles pulled off the list page so far. */
  collected: number;
  /** Profiles visited so far. */
  checked: number;
  /** Leads saved so far — the ones that matched, when the run carries a filter. */
  saved: number;
  /** How many matching leads the run is aiming for; null when it has no filter. */
  target: number | null;
  updatedAt: string;
}

interface ScrapeResultStoreDefinition extends ScrapeResultFilter {
  internalScrapeResult: true;
  scrapeJobId: string;
  leadIds: string[];
  progress?: ScrapeProgress;
  /**
   * The lead cap the job was created with.
   *
   * `scrape_jobs` has no column for it and the BullMQ job that carried it is removed after seven
   * days, so without this a "continue this scrape" a week later would have nothing to tell the new
   * run how many leads the old one was asked for. Absent on jobs created before this existed —
   * callers fall back to SCRAPE_CAP_LEADS_DEFAULT.
   */
  capLeads?: number;
  /**
   * When the account this job is waiting on comes off its rate-limit cooldown.
   *
   * Written when a run is paused by a 429 so the job page can count down to the moment it can be
   * resumed, rather than printing the ISO timestamp that used to sit in the error message. The
   * account's Redis cooldown is the live authority; this is the record of what this job was told,
   * and it outlives that key's TTL.
   */
  resumeAt?: string;
}

type ScrapeResultStore = Omit<LeadList, "filterDefinition"> & {
  filterDefinition: ScrapeResultStoreDefinition;
};

function resultStoreName(scrapeJobId: string): string {
  return `${RESULT_STORE_PREFIX}${scrapeJobId}`;
}

export function isInternalScrapeResultList(list: LeadList): boolean {
  return (list.filterDefinition as Partial<ScrapeResultStoreDefinition>).internalScrapeResult === true;
}

export async function getScrapeResultStore(userId: string, scrapeJobId: string): Promise<ScrapeResultStore | null> {
  const { rows } = await studioList<ScrapeResultStore>("lead_lists", {
    filter: { userId, name: resultStoreName(scrapeJobId) },
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function createScrapeResultStore(
  userId: string,
  scrapeJobId: string,
  resultFilterDefinition: ScrapeResultFilter,
  capLeads: number
): Promise<ScrapeResultStore> {
  return studioInsert<ScrapeResultStore>("lead_lists", {
    userId,
    name: resultStoreName(scrapeJobId),
    filterDefinition: {
      internalScrapeResult: true,
      scrapeJobId,
      leadIds: [],
      capLeads,
      ...resultFilterDefinition,
    },
  });
}

/**
 * Adds to the job's membership rather than replacing it — leads are now written as the run finds
 * them, a few at a time, so each call has to keep everything recorded by the calls before it.
 */
export async function saveScrapeJobLeadIds(userId: string, scrapeJobId: string, leadIds: string[]): Promise<void> {
  const store = await getScrapeResultStore(userId, scrapeJobId);
  if (!store) throw new Error(`Missing result store for scrape job ${scrapeJobId}`);
  await studioUpdate<ScrapeResultStore>("lead_lists", store.id, {
    filterDefinition: {
      ...store.filterDefinition,
      leadIds: [...new Set([...store.filterDefinition.leadIds, ...leadIds])],
    },
  });
}

export async function saveScrapeProgress(
  userId: string,
  scrapeJobId: string,
  progress: Omit<ScrapeProgress, "updatedAt">
): Promise<void> {
  const store = await getScrapeResultStore(userId, scrapeJobId);
  if (!store) return;
  await studioUpdate<ScrapeResultStore>("lead_lists", store.id, {
    filterDefinition: {
      ...store.filterDefinition,
      progress: { ...progress, updatedAt: new Date().toISOString() },
    },
  });
}

/**
 * Records when a job paused by a rate limit may be resumed, so the job page can count down to it.
 *
 * A read-modify-write on the same JSONB column the rest of this store uses, and safe for the same
 * reason the others are: it is called once, from the worker, after the run has stopped writing
 * progress.
 */
export async function saveScrapeResumeAt(userId: string, scrapeJobId: string, resumeAt: Date): Promise<void> {
  const store = await getScrapeResultStore(userId, scrapeJobId);
  if (!store) return;
  await studioUpdate<ScrapeResultStore>("lead_lists", store.id, {
    filterDefinition: { ...store.filterDefinition, resumeAt: resumeAt.toISOString() },
  });
}

/** Drops a stale resume time when a job goes back on the queue. */
export async function clearScrapeResumeAt(userId: string, scrapeJobId: string): Promise<void> {
  const store = await getScrapeResultStore(userId, scrapeJobId);
  if (!store?.filterDefinition.resumeAt) return;
  const next = { ...store.filterDefinition };
  delete next.resumeAt;
  await studioUpdate<ScrapeResultStore>("lead_lists", store.id, { filterDefinition: next });
}

function finishRequestName(scrapeJobId: string): string {
  return `${FINISH_REQUEST_PREFIX}${scrapeJobId}`;
}

function pauseRequestName(scrapeJobId: string): string {
  return `${PAUSE_REQUEST_PREFIX}${scrapeJobId}`;
}

/** Records "stop where you are, keep what you have, stay resumable" for a run already going. */
export async function requestScrapePauseRow(userId: string, scrapeJobId: string): Promise<void> {
  if (await isScrapePauseRequested(userId, scrapeJobId)) return;
  await studioInsert("lead_lists", {
    userId,
    name: pauseRequestName(scrapeJobId),
    filterDefinition: { internalScrapeResult: true, scrapeJobId, leadIds: [], pauseRequested: true },
  });
}

export async function isScrapePauseRequested(userId: string, scrapeJobId: string): Promise<boolean> {
  const { rows } = await studioList<LeadList>("lead_lists", {
    filter: { userId, name: pauseRequestName(scrapeJobId) },
    limit: 1,
  });
  return rows.length > 0;
}

export async function clearScrapePauseRequest(userId: string, scrapeJobId: string): Promise<void> {
  const { rows } = await studioList<LeadList>("lead_lists", {
    filter: { userId, name: pauseRequestName(scrapeJobId) },
    limit: 1,
  });
  if (rows[0]) await studioDelete("lead_lists", rows[0].id);
}

/** Records "stop looking and wrap up with what you have" for a run that's already going. */
export async function requestScrapeFinishRow(userId: string, scrapeJobId: string): Promise<void> {
  if (await isScrapeFinishRequested(userId, scrapeJobId)) return;
  await studioInsert("lead_lists", {
    userId,
    name: finishRequestName(scrapeJobId),
    filterDefinition: { internalScrapeResult: true, scrapeJobId, leadIds: [], finishRequested: true },
  });
}

export async function isScrapeFinishRequested(userId: string, scrapeJobId: string): Promise<boolean> {
  const { rows } = await studioList<LeadList>("lead_lists", {
    filter: { userId, name: finishRequestName(scrapeJobId) },
    limit: 1,
  });
  return rows.length > 0;
}

export async function clearScrapeFinishRequest(userId: string, scrapeJobId: string): Promise<void> {
  const { rows } = await studioList<LeadList>("lead_lists", {
    filter: { userId, name: finishRequestName(scrapeJobId) },
    limit: 1,
  });
  if (rows[0]) await studioDelete("lead_lists", rows[0].id);
}

export async function updateScrapeResultStoreFilter(
  userId: string,
  scrapeJobId: string,
  filter: ScrapeResultFilter
): Promise<ScrapeResultStore | null> {
  const store = await getScrapeResultStore(userId, scrapeJobId);
  if (!store) return null;
  return studioUpdate<ScrapeResultStore>("lead_lists", store.id, {
    filterDefinition: {
      internalScrapeResult: true,
      scrapeJobId,
      leadIds: store.filterDefinition.leadIds,
      // Rebuilt from scratch so clearing a filter really clears it — which means everything in the
      // store that is *not* part of the filter has to be carried across by hand. Re-filtering a job
      // otherwise forgot the cap it was asked for and when it was allowed to resume.
      ...(store.filterDefinition.capLeads !== undefined ? { capLeads: store.filterDefinition.capLeads } : {}),
      ...(store.filterDefinition.resumeAt !== undefined ? { resumeAt: store.filterDefinition.resumeAt } : {}),
      ...(store.filterDefinition.progress !== undefined ? { progress: store.filterDefinition.progress } : {}),
      ...filter,
    },
  });
}

export async function deleteScrapeResultStore(userId: string, scrapeJobId: string): Promise<void> {
  const store = await getScrapeResultStore(userId, scrapeJobId);
  if (store) await studioDelete("lead_lists", store.id);
  await clearScrapeFinishRequest(userId, scrapeJobId);
  await clearScrapePauseRequest(userId, scrapeJobId);
}

export function attachScrapeResultSettings(job: ScrapeJob, store: ScrapeResultStore | null): ScrapeJob {
  if (!store) {
    return {
      ...job,
      resultFilterDefinition: {},
      tracksExactLeads: false,
      progress: null,
      capLeads: null,
      resumeAt: null,
    };
  }
  const { minFollowers, maxFollowers, location, verifiedOnly, progress, capLeads, resumeAt } =
    store.filterDefinition;
  return {
    ...job,
    capLeads: capLeads ?? null,
    resumeAt: resumeAt ?? null,
    resultFilterDefinition: {
      ...(minFollowers !== undefined ? { minFollowers } : {}),
      ...(maxFollowers !== undefined ? { maxFollowers } : {}),
      ...(location ? { location } : {}),
      // Only when set: an unchecked box is the absence of a filter, not a filter that keeps
      // everything, and the job page reads "is there a filter at all" off these keys.
      ...(verifiedOnly ? { verifiedOnly } : {}),
    },
    tracksExactLeads: true,
    progress: progress ?? null,
  };
}

export function scrapeResultLeadIds(store: ScrapeResultStore): string[] {
  return store.filterDefinition.leadIds;
}

/** The lead cap a job was created with, or null for jobs that predate it being recorded. */
export function scrapeResultCapLeads(store: ScrapeResultStore | null): number | null {
  return store?.filterDefinition.capLeads ?? null;
}
