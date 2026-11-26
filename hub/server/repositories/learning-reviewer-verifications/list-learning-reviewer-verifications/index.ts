import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function listLearningReviewerVerifications(
  database: Pick<PrismaClient, "learningReviewerVerification">,
  input: { repositoryId: string; commitSha: string },
) {
  return database.learningReviewerVerification.findMany({
    where: input,
    orderBy: [{ verifiedAt: "asc" }, { id: "asc" }],
    select: { prototypeId: true, verifiedAt: true },
  })
}
