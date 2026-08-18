import { studioDelete, studioInsert, studioList, studioUpdate } from "../../db/studio-client.js";
import type { LeadList, ScrapeJob, ScrapeResultFilter } from "../../db/schema.js";

const RESULT_STORE_PREFIX = "__talonr_scrape__:";

interface ScrapeResultStoreDefinition extends ScrapeResultFilter {
  internalScrapeResult: true;
  scrapeJobId: string;
  leadIds: string[];
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

export async function saveScrapeJobLeadIds(userId: string, scrapeJobId: string, leadIds: string[]): Promise<void> {
  const store = await getScrapeResultStore(userId, scrapeJobId);
  if (!store) throw new Error(`Missing result store for scrape job ${scrapeJobId}`);
  await studioUpdate<ScrapeResultStore>("lead_lists", store.id, {
    filterDefinition: { ...store.filterDefinition, leadIds: [...new Set(leadIds)] },
  });
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
}

export function attachScrapeResultSettings(job: ScrapeJob, store: ScrapeResultStore | null): ScrapeJob {
  if (!store) return { ...job, resultFilterDefinition: {}, tracksExactLeads: false };
  const { minFollowers, maxFollowers, location } = store.filterDefinition;
  return {
    ...job,
    resultFilterDefinition: {
      ...(minFollowers !== undefined ? { minFollowers } : {}),
      ...(maxFollowers !== undefined ? { maxFollowers } : {}),
      ...(location ? { location } : {}),
    },
    tracksExactLeads: true,
  };
}

export function scrapeResultLeadIds(store: ScrapeResultStore): string[] {
  return store.filterDefinition.leadIds;
}
