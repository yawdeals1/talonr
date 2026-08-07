import { studioInsert } from "../../db/studio-client.js";
import type { ActivityLog } from "../../db/schema.js";

export async function logActivity(
  userId: string,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await studioInsert<ActivityLog>("activity_log", { userId, action, metadata: metadata ?? null });
}
