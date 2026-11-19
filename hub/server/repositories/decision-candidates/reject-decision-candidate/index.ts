import type { Prisma } from "../../../generated/prisma/client.ts"

export async function rejectDecisionCandidate(
  database: Pick<Prisma.TransactionClient, "decisionCandidate" | "decisionModelPromotion">,
  input: {
    repositoryId: string
    candidateId: string
    rejectedByMembershipId: string
    reason: string
    rejectedAt: Date
  },
) {
  const currentPromotion = await database.decisionModelPromotion.findFirst({
    where: { repositoryId: input.repositoryId },
    select: { candidateId: true },
    orderBy: [{ runtimeGeneration: "desc" }, { id: "desc" }],
  })
  if (currentPromotion?.candidateId === input.candidateId) {
    return { status: "promoted" as const }
  }
  const updated = await database.decisionCandidate.updateMany({
    where: {
      id: input.candidateId,
      repositoryId: input.repositoryId,
      rejectedAt: null,
    },
    data: {
      rejectedByMembershipId: input.rejectedByMembershipId,
      rejectedReason: input.reason,
      rejectedAt: input.rejectedAt,
    },
  })
  if (updated.count === 1) {
    return {
      status: "rejected" as const,
      candidate: await database.decisionCandidate.findUniqueOrThrow({
        where: { id: input.candidateId },
      }),
    }
  }
  const candidate = await database.decisionCandidate.findFirst({
    where: { id: input.candidateId, repositoryId: input.repositoryId },
  })
  return candidate
    ? { status: "already-rejected" as const, candidate }
    : { status: "not-found" as const }
}
