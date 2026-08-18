import { studioListSorted } from "../../db/studio-client.js";
import { normalizeStudioSourceType } from "../../db/source-type-compat.js";
import type { ActivityLog, ScrapeJob, User, XAccount } from "../../db/schema.js";

const byCreatedAtDesc = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);

export async function listAllUsers() {
  const users = await studioListSorted<User>("users", { cap: 5000 }, byCreatedAtDesc);
  return users.map(({ id, email, role, createdAt }) => ({ id, email, role, createdAt }));
}

/** Status/limits only — never returns encrypted_session or encrypted_proxy. */
export async function listUserAccounts(userId: string) {
  const accounts = await studioListSorted<XAccount>("x_accounts", { filter: { userId } }, byCreatedAtDesc);
  return accounts.map(({ id, userId: uid, handle, status, dailyScrapeLimit, maxConcurrency, lastUsedAt, createdAt }) => ({
    id,
    userId: uid,
    handle,
    status,
    dailyScrapeLimit,
    maxConcurrency,
    lastUsedAt,
    createdAt,
  }));
}

export interface AdminScrapeJobFilters {
  userId?: string;
  status?: "queued" | "running" | "completed" | "failed" | "paused";
}

export async function listAllScrapeJobs(filters: AdminScrapeJobFilters) {
  const jobs = await studioListSorted<ScrapeJob>(
    "scrape_jobs",
    { filter: { ...(filters.userId ? { userId: filters.userId } : {}), ...(filters.status ? { status: filters.status } : {}) }, cap: 200 },
    byCreatedAtDesc
  );
  return jobs.slice(0, 200).map(normalizeStudioSourceType);
}

export interface AdminActivityFilters {
  userId?: string;
  action?: string;
  page?: number;
  pageSize?: number;
}

export async function listActivity(filters: AdminActivityFilters) {
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 50, 200);

  const all = await studioListSorted<ActivityLog>(
    "activity_log",
    { filter: { ...(filters.userId ? { userId: filters.userId } : {}), ...(filters.action ? { action: filters.action } : {}) }, cap: 5000 },
    byCreatedAtDesc
  );

  const start = (page - 1) * pageSize;
  return { activity: all.slice(start, start + pageSize), page, pageSize };
}
