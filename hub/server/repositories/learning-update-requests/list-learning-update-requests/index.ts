import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Lists learnings with new scores, oldest first, so none waits behind newer ones. */
export function listLearningUpdateRequests(database: Pick<PrismaClient, "learningUpdateRequest">) {
  return database.learningUpdateRequest.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  })
}
