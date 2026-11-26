import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Stops sharing a learning. The row stays so its history shows who shared and withdrew it.
 */
export function withdrawLearningShare(
  database: Pick<Prisma.TransactionClient, "learningShare">,
  input: { repositoryId: string; learningId: string; membershipId: string; at: Date },
) {
  return database.learningShare.updateMany({
    where: { repositoryId: input.repositoryId, learningId: input.learningId, withdrawnAt: null },
    data: { withdrawnAt: input.at, withdrawnByMembershipId: input.membershipId },
  })
}
