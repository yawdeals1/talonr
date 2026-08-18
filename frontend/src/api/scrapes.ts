import { apiFetch } from "./client";
import type { EngagementType, ScrapeJob, ScrapeJobStatus, SourceType } from "./types";

export interface CreateScrapeInput {
  xAccountId: string;
  sourceType: SourceType;
  sourceRef: string;
  engagementTypes?: EngagementType[];
  capLeads?: number;
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

export function cancelScrape(id: string): Promise<{ scrapeJob: ScrapeJob }> {
  return apiFetch(`/scrapes/${id}/cancel`, { method: "POST" });
}

export function deleteScrape(id: string): Promise<void> {
  return apiFetch(`/scrapes/${id}`, { method: "DELETE" });
}
