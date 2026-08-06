import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { activityLog, scrapeJobs, users, xAccounts } from "../../db/schema.js";

export async function listAllUsers() {
  return db.query.users.findMany({
    columns: { id: true, email: true, role: true, createdAt: true },
    orderBy: desc(users.createdAt),
  });
}

/** Status/limits only — never returns encrypted_session or encrypted_proxy. */
export async function listUserAccounts(userId: string) {
  return db.query.xAccounts.findMany({
    where: eq(xAccounts.userId, userId),
    columns: {
      id: true,
      userId: true,
      handle: true,
      status: true,
      dailyScrapeLimit: true,
      maxConcurrency: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
}

export interface AdminScrapeJobFilters {
  userId?: string;
  status?: "queued" | "running" | "completed" | "failed" | "paused";
}

export async function listAllScrapeJobs(filters: AdminScrapeJobFilters) {
  const conditions = [];
  if (filters.userId) conditions.push(eq(scrapeJobs.userId, filters.userId));
  if (filters.status) conditions.push(eq(scrapeJobs.status, filters.status));

  return db.query.scrapeJobs.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: desc(scrapeJobs.createdAt),
    limit: 200,
  });
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

  const conditions = [];
  if (filters.userId) conditions.push(eq(activityLog.userId, filters.userId));
  if (filters.action) conditions.push(eq(activityLog.action, filters.action));

  const rows = await db.query.activityLog.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: desc(activityLog.createdAt),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { activity: rows, page, pageSize };
}
