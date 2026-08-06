import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { leadLists, leads, type FilterDefinition } from "../../db/schema.js";
import { NotFoundError } from "../../lib/errors.js";
import { buildFilterCondition } from "./filter-query-builder.js";

export async function listLeadLists(userId: string) {
  return db.query.leadLists.findMany({
    where: eq(leadLists.userId, userId),
    orderBy: desc(leadLists.createdAt),
  });
}

async function findOwnedOrThrow(userId: string, id: string) {
  const list = await db.query.leadLists.findFirst({
    where: and(eq(leadLists.id, id), eq(leadLists.userId, userId)),
  });
  if (!list) throw new NotFoundError("Lead list not found");
  return list;
}

export async function getLeadList(userId: string, id: string) {
  return findOwnedOrThrow(userId, id);
}

export async function createLeadList(userId: string, name: string, filterDefinition: FilterDefinition) {
  const [list] = await db.insert(leadLists).values({ userId, name, filterDefinition }).returning();
  return list;
}

export async function updateLeadList(
  userId: string,
  id: string,
  input: Partial<{ name: string; filterDefinition: FilterDefinition }>
) {
  await findOwnedOrThrow(userId, id);
  const [list] = await db
    .update(leadLists)
    .set(input)
    .where(and(eq(leadLists.id, id), eq(leadLists.userId, userId)))
    .returning();
  return list;
}

export async function deleteLeadList(userId: string, id: string) {
  await findOwnedOrThrow(userId, id);
  await db.delete(leadLists).where(and(eq(leadLists.id, id), eq(leadLists.userId, userId)));
}

export async function evaluateLeadList(userId: string, id: string, page = 1, pageSize = 50) {
  const list = await findOwnedOrThrow(userId, id);
  const size = Math.min(pageSize, 200);
  const filterCondition = buildFilterCondition(list.filterDefinition);

  const rows = await db.query.leads.findMany({
    where: and(eq(leads.userId, userId), filterCondition),
    orderBy: desc(leads.lastSeenAt),
    limit: size,
    offset: (page - 1) * size,
  });

  return { list, leads: rows, page, pageSize: size };
}
