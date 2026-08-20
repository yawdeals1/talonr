import { Queue } from "bullmq";
import type { EngagementType, ScrapeResultFilter } from "../db/schema.js";
import { redisConnection } from "./connection.js";

export interface ScrapeJobData {
  scrapeJobId: string;
  userId: string;
  xAccountId: string;
  sourceType: "search" | "followers" | "engagers";
  sourceRef: string;
  // Required (non-empty) when sourceType is "engagers"; unused otherwise.
  engagementTypes?: EngagementType[];
  capLeads: number;
  /**
   * The follower/location filter the job was created with, if any. Carried on the job so the run
   * itself can aim for `capLeads` *matching* leads rather than collecting the first `capLeads`
   * accounts in the list and leaving the filter to hide most of them afterwards. Optional: jobs
   * enqueued before this existed simply don't have it.
   */
  resultFilter?: ScrapeResultFilter;
}

export const SCRAPE_QUEUE_NAME = "scrape";

export const scrapeQueue = new Queue<ScrapeJobData>(SCRAPE_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7 }, // 7 days
    removeOnFail: { age: 60 * 60 * 24 * 7 },
  },
});
