import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

/** Updates the checkpoint only while the caller still holds its lease. */
export async function updateGitHubWebhookRecoveryCheckpoint(
  database: Pick<PrismaClient, "gitHubWebhookRecoveryCheckpoint">,
  {
    appId,
    data,
    leaseId,
  }: {
    appId: string
    data: Pick<
      Prisma.GitHubWebhookRecoveryCheckpointUpdateManyMutationInput,
      "cursor" | "lastCompletedScanStartedAt" | "leaseExpiresAt" | "leaseId" | "scanStartedAt"
    >
    leaseId: string
  },
): Promise<boolean> {
  const { count } = await database.gitHubWebhookRecoveryCheckpoint.updateMany({
    data,
    where: { appId, leaseId },
  })
  return count === 1
}
