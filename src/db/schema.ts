// Plain TypeScript row types — the schema itself lives in Deploro's Studio DB (applied via
// `deploro migrate`, see the "talonr_schema" migration), not managed by an ORM here. These types
// exist purely for service-layer type safety against what src/db/studio-client.ts returns.
// Timestamp columns come back as ISO strings (studio-client.ts round-trips JSON, not a Postgres
// driver's native Date parsing) — every table has createdAt for that reason.

export type UserRole = "user" | "admin";
export type XAccountStatus = "active" | "checkpointed" | "banned";
export type SourceType = "search" | "followers" | "likers";
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
