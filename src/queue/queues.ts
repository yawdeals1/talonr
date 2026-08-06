import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";

export interface ScrapeJobData {
  scrapeJobId: string;
  userId: string;
  xAccountId: string;
  sourceType: "search" | "followers" | "likers";
  sourceRef: string;
  capLeads: number;
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
