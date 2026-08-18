import { apiFetch } from "./client";
import type { Lead, SourceType } from "./types";

export interface ListLeadsFilters {
  handle?: string;
  sourceType?: SourceType;
  sourceRef?: string;
  minFollowers?: number;
  maxFollowers?: number;
  location?: string;
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

export function deleteLead(id: string): Promise<void> {
  return apiFetch(`/leads/${id}`, { method: "DELETE" });
}
