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

// "likers" is legacy-only — X made "who liked a post" private platform-wide in June 2024, so it
// stays filterable for old data but can no longer be scraped. New engagement scrapes use
// "engagers" (replies and/or retweets, see EngagementType).
export type SourceType = "search" | "followers" | "likers" | "engagers";
export type EngagementType = "repliers" | "retweeters";
export type ScrapeJobStatus = "queued" | "running" | "completed" | "failed" | "paused";

export interface ScrapeJob {
  id: string;
  userId: string;
  xAccountId: string;
  sourceType: SourceType;
  sourceRef: string;
  engagementTypes: EngagementType[] | null;
  resultFilterDefinition: ScrapeResultFilter;
  tracksExactLeads: boolean;
  status: ScrapeJobStatus;
  leadsFound: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ScrapeResultFilter {
  minFollowers?: number;
  maxFollowers?: number;
  location?: string;
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
  leadIds?: string[];
  bioKeywords?: string[];
  minFollowers?: number;
  maxFollowers?: number;
  location?: string;
  verifiedOnly?: boolean;
  maxLeads?: number;
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
