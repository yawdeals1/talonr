import { apiFetch } from "./client";
import type { ActivityLogEntry, AdminUser, AdminXAccount, ScrapeJob, ScrapeJobStatus } from "./types";

export function listUsers(): Promise<{ users: AdminUser[] }> {
  return apiFetch("/admin/users");
}

export function listUserAccounts(userId: string): Promise<{ accounts: AdminXAccount[] }> {
  return apiFetch(`/admin/users/${userId}/accounts`);
}

export interface AdminScrapeJobFilters {
  userId?: string;
  status?: ScrapeJobStatus;
}

export function listAllScrapeJobs(filters: AdminScrapeJobFilters = {}): Promise<{ scrapeJobs: ScrapeJob[] }> {
  return apiFetch("/admin/scrape-jobs", { query: filters });
}

export interface AdminActivityFilters {
  userId?: string;
  action?: string;
  page?: number;
  pageSize?: number;
}

export function listActivity(
  filters: AdminActivityFilters = {}
): Promise<{ activity: ActivityLogEntry[]; page: number; pageSize: number }> {
  return apiFetch("/admin/activity", { query: filters });
}
