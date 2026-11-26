import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Remembers that a learning has a new score, so the daily job checks it for a suggested
 * update. A repeat raises the revision, so a check already running keeps the request.
 */
export function recordLearningUpdateRequest(
  database: Pick<PrismaClient, "learningUpdateRequest">,
  input: { repositoryId: string; memoryId: string },
) {
  return database.learningUpdateRequest.upsert({
    where: { repositoryId_memoryId: input },
    create: input,
    update: { revision: { increment: 1 } },
  })
}
