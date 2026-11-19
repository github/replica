import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Leases the App's checkpoint when no other worker holds an unexpired lease. */
export async function claimGitHubWebhookRecoveryCheckpoint(
  database: Pick<PrismaClient, "gitHubWebhookRecoveryCheckpoint">,
  {
    appId,
    leaseExpiresAt,
    leaseId,
    now,
  }: { appId: string; leaseExpiresAt: Date; leaseId: string; now: Date },
) {
  await database.gitHubWebhookRecoveryCheckpoint.createMany({
    data: [{ appId }],
    skipDuplicates: true,
  })
  const { count } = await database.gitHubWebhookRecoveryCheckpoint.updateMany({
    data: { leaseExpiresAt, leaseId },
    where: { appId, OR: [{ leaseId: null }, { leaseExpiresAt: { lte: now } }] },
  })
  if (count === 0) return null
  return database.gitHubWebhookRecoveryCheckpoint.findUniqueOrThrow({
    select: { cursor: true, lastCompletedScanStartedAt: true, scanStartedAt: true },
    where: { appId },
  })
}
