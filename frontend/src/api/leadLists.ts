import { apiFetch } from "./client";
import type { FilterDefinition, Lead, LeadList } from "./types";

export function listLeadLists(): Promise<{ leadLists: LeadList[] }> {
  return apiFetch("/lead-lists");
}

export function getLeadList(id: string): Promise<{ leadList: LeadList }> {
  return apiFetch(`/lead-lists/${id}`);
}

export function createLeadList(name: string, filterDefinition: FilterDefinition): Promise<{ leadList: LeadList }> {
  return apiFetch("/lead-lists", { method: "POST", body: { name, filterDefinition } });
}

export interface UpdateLeadListInput {
  name?: string;
  filterDefinition?: FilterDefinition;
}

export function updateLeadList(id: string, input: UpdateLeadListInput): Promise<{ leadList: LeadList }> {
  return apiFetch(`/lead-lists/${id}`, { method: "PATCH", body: input });
}

export function deleteLeadList(id: string): Promise<void> {
  return apiFetch(`/lead-lists/${id}`, { method: "DELETE" });
}

export function evaluateLeadList(
  id: string,
  page?: number,
  pageSize?: number
): Promise<{ list: LeadList; leads: Lead[]; page: number; pageSize: number; total: number }> {
  return apiFetch(`/lead-lists/${id}/leads`, { query: { page, pageSize } });
}
