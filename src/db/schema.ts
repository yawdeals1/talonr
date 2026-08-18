// Plain TypeScript row types — the schema itself lives in Deploro's Studio DB (applied via
// `deploro migrate`, see the "talonr_schema" migration), not managed by an ORM here. These types
// exist purely for service-layer type safety against what src/db/studio-client.ts returns.
// Timestamp columns come back as ISO strings (studio-client.ts round-trips JSON, not a Postgres
// driver's native Date parsing) — every table has createdAt for that reason.

export type UserRole = "user" | "admin";
export type XAccountStatus = "active" | "checkpointed" | "banned";
// "likers" is legacy-only (X made "who liked a post" private platform-wide in June 2024, with
// no workaround — see the retweeters/repliers source modules) — kept solely so historical
// scrape_jobs/leads rows still typecheck; new jobs can no longer be created with it.
export type SourceType = "search" | "followers" | "likers" | "engagers";
export type EngagementType = "repliers" | "retweeters";
export type ScrapeJobStatus = "queued" | "running" | "completed" | "failed" | "paused";

export interface User {
  id: string;
  email: string;
  // Deploro Auth-as-a-Service account id (gallium_platform.auth_accounts.id) — identity and
  // credentials live in Deploro; this row is auto-provisioned on first successful session
  // validation and only ever holds local, Talonr-specific state (role, FK anchor for
  // x_accounts/scrape_jobs/leads/etc). See src/modules/auth/deploro-auth.client.ts.
  deploroAccountId: string;
  role: UserRole;
  createdAt: string;
}

export interface XAccount {
  id: string;
  userId: string;
  handle: string;
  // AES-256-GCM envelope of Playwright storageState JSON. Null until `npm run login:x` captures a
  // session for this account. Never returned via any API response.
  encryptedSession: string | null;
  // AES-256-GCM envelope of {server, username, password} JSON, nullable.
  encryptedProxy: string | null;
  status: XAccountStatus;
  dailyScrapeLimit: number;
  maxConcurrency: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ScrapeJob {
  id: string;
  userId: string;
  xAccountId: string;
  sourceType: SourceType;
  sourceRef: string;
  // Only set (and only meaningful) when sourceType is "engagers" — which of the two engagement
  // strategies (repliers, retweeters) this job was asked to run. Null for every other source type.
  engagementTypes: EngagementType[] | null;
  resultFilterDefinition: ScrapeResultFilter;
  // False for jobs created before exact per-job lead membership was introduced. New jobs keep
  // exact lead ids and this filter in a hidden internal lead_lists JSONB record.
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
  // When set, this is a static list created from explicitly selected leads. It can still be
  // combined with the dynamic fields below if the list is edited later.
  leadIds?: string[];
  bioKeywords?: string[];
  minFollowers?: number;
  maxFollowers?: number;
  location?: string;
  verifiedOnly?: boolean;
  // Caps the total number of matched leads a list evaluation returns (across all pages), not a
  // per-page size — see lead-lists.service.ts#evaluateLeadList.
  maxLeads?: number;
}

export interface LeadList {
  id: string;
  userId: string;
  name: string;
  filterDefinition: FilterDefinition;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
