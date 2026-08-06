import { relations } from "drizzle-orm";
import { users, xAccounts, scrapeJobs, leads, leadLists, activityLog } from "./schema.js";

export const usersRelations = relations(users, ({ many }) => ({
  xAccounts: many(xAccounts),
  scrapeJobs: many(scrapeJobs),
  leads: many(leads),
  leadLists: many(leadLists),
  activityLog: many(activityLog),
}));

export const xAccountsRelations = relations(xAccounts, ({ one, many }) => ({
  user: one(users, { fields: [xAccounts.userId], references: [users.id] }),
  scrapeJobs: many(scrapeJobs),
}));

export const scrapeJobsRelations = relations(scrapeJobs, ({ one }) => ({
  user: one(users, { fields: [scrapeJobs.userId], references: [users.id] }),
  xAccount: one(xAccounts, { fields: [scrapeJobs.xAccountId], references: [xAccounts.id] }),
}));

export const leadsRelations = relations(leads, ({ one }) => ({
  user: one(users, { fields: [leads.userId], references: [users.id] }),
}));

export const leadListsRelations = relations(leadLists, ({ one }) => ({
  user: one(users, { fields: [leadLists.userId], references: [users.id] }),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  user: one(users, { fields: [activityLog.userId], references: [users.id] }),
}));
