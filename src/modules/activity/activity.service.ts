import { db } from "../../db/client.js";
import { activityLog } from "../../db/schema.js";

export async function logActivity(
  userId: string,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db.insert(activityLog).values({ userId, action, metadata });
}
