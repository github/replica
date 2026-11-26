import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Reads a commit's score request, including the revision that later reports raise. */
export function findLearningScoreRequest(
  database: Pick<PrismaClient, "learningScoreRequest">,
  input: { repositoryId: string; commitSha: string },
) {
  return database.learningScoreRequest.findUnique({
    where: { repositoryId_commitSha: input },
    select: { revision: true },
  })
}
