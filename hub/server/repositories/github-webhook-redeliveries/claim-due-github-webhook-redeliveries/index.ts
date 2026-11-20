import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { ClaimedGitHubWebhookRedelivery } from "../types.ts"

/**
 * Claims due redeliveries, including requests abandoned by a stopped worker. Each
 * claim is conditional on the row's state and attempt count, so only one wins.
 */
export async function claimDueGitHubWebhookRedeliveries(
  database: Pick<PrismaClient, "gitHubWebhookRedelivery">,
  {
    limit,
    maximumAttempts,
    now,
    staleBefore,
  }: {
    limit: number
    maximumAttempts: number
    now: Date
    staleBefore: Date
  },
): Promise<ClaimedGitHubWebhookRedelivery[]> {
  const due = await database.gitHubWebhookRedelivery.findMany({
    orderBy: { retryAt: "asc" },
    select: { attempts: true, githubDeliveryId: true, id: true, state: true },
    take: limit,
    where: {
      attempts: { lt: maximumAttempts },
      OR: [
        { retryAt: { lte: now }, state: { in: ["pending", "waiting"] } },
        { state: "requesting", updatedAt: { lte: staleBefore } },
      ],
    },
  })
  const claimed: ClaimedGitHubWebhookRedelivery[] = []
  for (const row of due) {
    const { count } = await database.gitHubWebhookRedelivery.updateMany({
      data: { attempts: { increment: 1 }, state: "requesting" },
      where: {
        attempts: { equals: row.attempts, lt: maximumAttempts },
        id: row.id,
        state: row.state,
      },
    })
    if (count === 1) {
      claimed.push({
        attempts: row.attempts + 1,
        githubDeliveryId:
          row.githubDeliveryId <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(row.githubDeliveryId)
            : row.githubDeliveryId.toString(),
        id: row.id,
      })
    }
  }
  return claimed
}
