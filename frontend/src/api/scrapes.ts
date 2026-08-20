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

export function deleteScrape(id: string): Promise<void> {
  return apiFetch(`/scrapes/${id}`, { method: "DELETE" });
}

export function bulkDeleteScrapes(ids: string[]): Promise<{ deletedCount: number }> {
  return apiFetch("/scrapes/bulk-delete", { method: "POST", body: { ids } });
}
