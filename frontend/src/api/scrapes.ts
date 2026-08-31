import { apiFetch } from "./client";
import type { EngagementType, Lead, ScrapeJob, ScrapeJobStatus, ScrapeResultFilter, SourceType } from "./types";

export interface CreateScrapeInput {
  xAccountId: string;
  sourceType: SourceType;
  sourceRef: string;
  engagementTypes?: EngagementType[];
  capLeads?: number;
  resultFilterDefinition?: ScrapeResultFilter;
}

export function createScrape(input: CreateScrapeInput): Promise<{ scrapeJob: ScrapeJob }> {
  return apiFetch("/scrapes", { method: "POST", body: input });
}

export interface ListScrapesFilters {
  status?: ScrapeJobStatus;
  xAccountId?: string;
}

export function listScrapes(filters: ListScrapesFilters = {}): Promise<{ scrapeJobs: ScrapeJob[] }> {
  return apiFetch("/scrapes", { query: filters });
}

export function getScrape(id: string): Promise<{ scrapeJob: ScrapeJob }> {
  return apiFetch(`/scrapes/${id}`);
}

export function listScrapeLeads(
  id: string,
  page?: number,
  pageSize?: number
): Promise<{
  scrapeJob: ScrapeJob;
  leads: Lead[];
  page: number;
  pageSize: number;
  total: number;
  exactMembershipAvailable: boolean;
}> {
  return apiFetch(`/scrapes/${id}/leads`, { query: { page, pageSize } });
}

export function updateScrapeResultFilter(
  id: string,
  filter: ScrapeResultFilter
): Promise<{ scrapeJob: ScrapeJob }> {
  return apiFetch(`/scrapes/${id}/result-filter`, { method: "PATCH", body: filter });
}

export function cancelScrape(id: string): Promise<{ scrapeJob: ScrapeJob }> {
  return apiFetch(`/scrapes/${id}/cancel`, { method: "POST" });
}

/** Asks a running scrape to stop looking and complete with what it has already found. */
export function finishScrape(id: string): Promise<{ scrapeJob: ScrapeJob }> {
  return apiFetch(`/scrapes/${id}/finish`, { method: "POST" });
}

/**
 * Stops a running or queued scrape and leaves it resumable.
 *
 * Distinct from both of the stops that already existed: a cancel is terminal, and "finish" ends the
 * job as completed. A pause keeps every lead and can be picked back up from where it stopped.
 */
export function pauseScrape(id: string): Promise<{ scrapeJob: ScrapeJob }> {
  return apiFetch(`/scrapes/${id}/pause`, { method: "POST" });
}

/**
 * Puts a paused scrape back on the queue, carrying on rather than starting over — it skips the
 * accounts already collected from this target. Works whatever paused it: you, a rate limit, or the
 * account's daily quota.
 */
export function resumeScrape(id: string): Promise<{ scrapeJob: ScrapeJob }> {
  return apiFetch(`/scrapes/${id}/resume`, { method: "POST" });
}

/**
 * Runs the same target again for more leads, as a new job that skips what this one already found.
 * The counterpart to resume, for a scrape that is finished rather than paused.
 */
export function continueScrape(id: string): Promise<{ scrapeJob: ScrapeJob }> {
  return apiFetch(`/scrapes/${id}/continue`, { method: "POST" });
}

export function deleteScrape(id: string): Promise<void> {
  return apiFetch(`/scrapes/${id}`, { method: "DELETE" });
}

export function bulkDeleteScrapes(ids: string[]): Promise<{ deletedCount: number }> {
  return apiFetch("/scrapes/bulk-delete", { method: "POST", body: { ids } });
}
