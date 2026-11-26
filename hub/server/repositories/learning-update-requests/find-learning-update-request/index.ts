import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function findLearningUpdateRequest(
  database: Pick<PrismaClient, "learningUpdateRequest">,
  id: string,
) {
  return database.learningUpdateRequest.findUnique({
    where: { id },
    select: { id: true, repositoryId: true, memoryId: true, revision: true },
  })
}
