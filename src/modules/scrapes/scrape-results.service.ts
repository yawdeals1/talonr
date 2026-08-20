import { studioDelete, studioInsert, studioList, studioUpdate } from "../../db/studio-client.js";
import type { LeadList, ScrapeJob, ScrapeResultFilter } from "../../db/schema.js";

const RESULT_STORE_PREFIX = "__talonr_scrape__:";
// A "wrap up now" request lives in its own row rather than in the result store above, so the two
// writers never collide: the API only ever creates this row, the worker only ever reads and
// deletes it. The store itself is written continuously by the running worker (lead ids, progress),
// and `filter_definition` is a single JSONB column — a PATCH rewrites all of it, so a flag written
// into it by the API could be clobbered by the worker's next progress write.
const FINISH_REQUEST_PREFIX = "__talonr_scrape_finish__:";

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
  resultFilterDefinition: ScrapeResultFilter
): Promise<ScrapeResultStore> {
  return studioInsert<ScrapeResultStore>("lead_lists", {
    userId,
    name: resultStoreName(scrapeJobId),
    filterDefinition: {
      internalScrapeResult: true,
      scrapeJobId,
      leadIds: [],
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

function finishRequestName(scrapeJobId: string): string {
  return `${FINISH_REQUEST_PREFIX}${scrapeJobId}`;
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
      ...filter,
    },
  });
}

export async function deleteScrapeResultStore(userId: string, scrapeJobId: string): Promise<void> {
  const store = await getScrapeResultStore(userId, scrapeJobId);
  if (store) await studioDelete("lead_lists", store.id);
  await clearScrapeFinishRequest(userId, scrapeJobId);
}

export function attachScrapeResultSettings(job: ScrapeJob, store: ScrapeResultStore | null): ScrapeJob {
  if (!store) return { ...job, resultFilterDefinition: {}, tracksExactLeads: false, progress: null };
  const { minFollowers, maxFollowers, location, progress } = store.filterDefinition;
  return {
    ...job,
    resultFilterDefinition: {
      ...(minFollowers !== undefined ? { minFollowers } : {}),
      ...(maxFollowers !== undefined ? { maxFollowers } : {}),
      ...(location ? { location } : {}),
    },
    tracksExactLeads: true,
    progress: progress ?? null,
  };
}

export function scrapeResultLeadIds(store: ScrapeResultStore): string[] {
  return store.filterDefinition.leadIds;
}
