export type UserRole = "user" | "admin";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export type XAccountStatus = "active" | "checkpointed" | "banned";

export interface XAccount {
  id: string;
  handle: string;
  status: XAccountStatus;
  hasSession: boolean;
  hasProxy: boolean;
  dailyScrapeLimit: number;
  maxConcurrency: number;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Admin cross-user view — same shape as XAccount plus the owning user's id. */
export interface AdminXAccount extends XAccount {
  userId: string;
}

export type SourceType = "search" | "followers" | "likers";
export type ScrapeJobStatus = "queued" | "running" | "completed" | "failed" | "paused";

export interface ScrapeJob {
  id: string;
  userId: string;
  xAccountId: string;
  sourceType: SourceType;
  sourceRef: string;
  status: ScrapeJobStatus;
  leadsFound: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface Lead {
  id: string;
  userId: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  followers: number | null;
  location: string | null;
  verified: boolean;
  profileImage: string | null;
  sourceType: SourceType;
  sourceRef: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface FilterDefinition {
  bioKeywords?: string[];
  minFollowers?: number;
  maxFollowers?: number;
  location?: string;
  verifiedOnly?: boolean;
}

export interface LeadList {
  id: string;
  userId: string;
  name: string;
  filterDefinition: FilterDefinition;
  createdAt: string;
}

export interface ActivityLogEntry {
  id: string;
  userId: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}
