import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Drops a score request once scoring has read it. A report that arrives meanwhile raises
 * the revision and keeps the request, so its learnings are scored on the next pass.
 */
export function deleteLearningScoreRequest(
  database: Pick<PrismaClient, "learningScoreRequest">,
  input: { repositoryId: string; commitSha: string; revision: number },
) {
  return database.learningScoreRequest.deleteMany({
    where: {
      repositoryId: input.repositoryId,
      commitSha: input.commitSha,
      revision: input.revision,
    },
  })
}
