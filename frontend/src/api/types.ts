export type UserRole = "user" | "admin";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export type XAccountStatus = "active" | "checkpointed" | "banned";

/**
 * The result of re-checking a checkpointed account's stored session against X, while it is still
 * fresh. Short-lived by design — the durable outcome is the account's own `status`.
 */
export type AccountSessionCheck =
  | { state: "queued"; at: string }
  | { state: "checking"; at: string }
  | { state: "healthy"; at: string }
  | { state: "unhealthy"; at: string; reason: string };

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
  /**
   * Set while X is throttling this account. It stays connected and stays `active` — it is simply
   * resting, and queued scrapes start themselves once this passes. Not the same as `checkpointed`.
   */
  cooldownUntil: string | null;
  cooldownReason: string | null;
  sessionCheck: AccountSessionCheck | null;
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

/** Live counters a running scrape publishes so the job page can show what it's doing. */
export interface ScrapeProgress {
  phase: "collecting" | "checking";
  collected: number;
  checked: number;
  saved: number;
  target: number | null;
  updatedAt: string;
}

export interface ScrapeJob {
  id: string;
  userId: string;
  xAccountId: string;
  sourceType: SourceType;
  sourceRef: string;
  engagementTypes: EngagementType[] | null;
  resultFilterDefinition: ScrapeResultFilter;
  tracksExactLeads: boolean;
  progress: ScrapeProgress | null;
  /**
   * The lead cap this run was asked for. Null for jobs created before it was recorded — the number
   * lives alongside the filter rather than in a column, so there is nothing to read for those.
   */
  capLeads: number | null;
  /**
   * When a run paused by X's rate limit may be resumed, ISO. Null for every other kind of pause,
   * and the thing the job page counts down to instead of printing a raw timestamp.
   */
  resumeAt: string | null;
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
  verifiedOnly?: boolean;
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
