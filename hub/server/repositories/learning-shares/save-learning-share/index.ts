import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Shares a learning with every repository. Sharing one that was withdrawn shares it again
 * under the new sharer, so one row always describes the current share.
 */
export function saveLearningShare(
  database: Pick<Prisma.TransactionClient, "learningShare">,
  input: { repositoryId: string; learningId: string; membershipId: string; at: Date },
) {
  const shared = {
    sharedByMembershipId: input.membershipId,
    sharedAt: input.at,
    withdrawnAt: null,
    withdrawnByMembershipId: null,
  }
  return database.learningShare.upsert({
    where: {
      repositoryId_learningId: { repositoryId: input.repositoryId, learningId: input.learningId },
    },
    create: { repositoryId: input.repositoryId, learningId: input.learningId, ...shared },
    update: shared,
  })
}
