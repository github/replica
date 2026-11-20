import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getDecisionCandidate(
  database: Pick<Prisma.TransactionClient, "decisionCandidate">,
  repositoryId: string,
  idOrRuntimeId: string,
) {
  return database.decisionCandidate.findFirst({
    where: {
      repositoryId,
      OR: [{ id: idOrRuntimeId }, { runtimeCandidateId: idOrRuntimeId }],
    },
    include: { trainingJob: { select: { consentGrantId: true, questionDigest: true } } },
  })
}
