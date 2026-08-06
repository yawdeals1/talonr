import { apiFetch } from "./client";
import type { Lead, SourceType } from "./types";

export interface ListLeadsFilters {
  handle?: string;
  sourceType?: SourceType;
  page?: number;
  pageSize?: number;
}

export function listLeads(
  filters: ListLeadsFilters = {}
): Promise<{ leads: Lead[]; page: number; pageSize: number }> {
  return apiFetch("/leads", { query: filters });
}

export function getLead(id: string): Promise<{ lead: Lead }> {
  return apiFetch(`/leads/${id}`);
}
