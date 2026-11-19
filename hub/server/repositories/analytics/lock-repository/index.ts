import type { Prisma } from "../../../generated/prisma/client.ts"

/** A write forces stale serializable product transactions to retry before fan-out. */
export async function lockAnalyticsRepository(tx: Prisma.TransactionClient, repositoryId: string) {
  await tx.analyticsRepositoryState.upsert({
    where: { repositoryId },
    create: { repositoryId },
    update: { updatedAt: new Date() },
    select: { id: true },
  })
}
