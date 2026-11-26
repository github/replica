import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Drops an update request once its check is done. A score that lands during the check
 * raises the revision, so the request stays and the learning is checked again.
 */
export function deleteLearningUpdateRequest(
  database: Pick<PrismaClient, "learningUpdateRequest">,
  input: { id: string; revision: number },
) {
  return database.learningUpdateRequest.deleteMany({
    where: { id: input.id, revision: input.revision },
  })
}
