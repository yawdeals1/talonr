import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const xAccountStatusEnum = pgEnum("x_account_status", ["active", "checkpointed", "banned"]);
export const sourceTypeEnum = pgEnum("source_type", ["search", "followers", "likers"]);
export const scrapeJobStatusEnum = pgEnum("scrape_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "paused",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const xAccounts = pgTable(
  "x_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    handle: varchar("handle", { length: 50 }).notNull(),
    // AES-256-GCM envelope of Playwright storageState JSON. Null until `npm run login:x` captures a
    // session for this account. Never returned via any API response.
    encryptedSession: text("encrypted_session"),
    // AES-256-GCM envelope of {server, username, password} JSON, nullable.
    encryptedProxy: text("encrypted_proxy"),
    status: xAccountStatusEnum("status").notNull().default("active"),
    dailyScrapeLimit: integer("daily_scrape_limit").notNull().default(150),
    maxConcurrency: integer("max_concurrency").notNull().default(1),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userHandleUnique: unique("x_accounts_user_handle_unique").on(t.userId, t.handle),
    userIdx: index("x_accounts_user_id_idx").on(t.userId),
  })
);

export const scrapeJobs = pgTable(
  "scrape_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    xAccountId: uuid("x_account_id")
      .notNull()
      .references(() => xAccounts.id, { onDelete: "cascade" }),
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    status: scrapeJobStatusEnum("status").notNull().default("queued"),
    leadsFound: integer("leads_found").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("scrape_jobs_user_id_idx").on(t.userId),
    accountIdx: index("scrape_jobs_x_account_id_idx").on(t.xAccountId),
    statusIdx: index("scrape_jobs_status_idx").on(t.status),
  })
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    handle: varchar("handle", { length: 50 }).notNull(),
    displayName: text("display_name"),
    bio: text("bio"),
    followers: integer("followers"),
    location: text("location"),
    verified: boolean("verified").notNull().default(false),
    profileImage: text("profile_image"),
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userHandleUnique: unique("leads_user_handle_unique").on(t.userId, t.handle),
    userIdx: index("leads_user_id_idx").on(t.userId),
    followersIdx: index("leads_followers_idx").on(t.followers),
  })
);

export interface FilterDefinition {
  bioKeywords?: string[];
  minFollowers?: number;
  maxFollowers?: number;
  location?: string;
  verifiedOnly?: boolean;
}

export const leadLists = pgTable(
  "lead_lists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    filterDefinition: jsonb("filter_definition").notNull().$type<FilterDefinition>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("lead_lists_user_id_idx").on(t.userId),
  })
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 100 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("activity_log_user_id_idx").on(t.userId),
    createdIdx: index("activity_log_created_at_idx").on(t.createdAt),
  })
);
