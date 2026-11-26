import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Remembers that an agent reported learning usage in a commit. A repeat report raises the
 * revision, so a scoring job already running keeps the request for another pass. The
 * database counts revisions, so clocks on different hosts can't reorder reports.
 */
export function recordLearningScoreRequest(
  database: Pick<PrismaClient, "learningScoreRequest">,
  input: { repositoryId: string; commitSha: string },
) {
  return database.learningScoreRequest.upsert({
    where: { repositoryId_commitSha: input },
    create: input,
    update: { revision: { increment: 1 } },
  })
}
