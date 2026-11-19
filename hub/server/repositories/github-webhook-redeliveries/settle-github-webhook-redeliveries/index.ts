import type { PrismaClient } from "../../../generated/prisma/client.ts"

const active = ["pending", "requesting", "waiting"] as const

/**
 * Ends active redeliveries that GitHub delivered or the Hub already processed, then
 * fails those past their redelivery window or out of attempts.
 */
export async function settleGitHubWebhookRedeliveries(
  database: Pick<PrismaClient, "gitHubWebhookDelivery" | "gitHubWebhookRedelivery">,
  {
    deliveredIds,
    maximumAttempts,
    now,
  }: { deliveredIds: string[]; maximumAttempts: number; now: Date },
): Promise<void> {
  const activeIds = (
    await database.gitHubWebhookRedelivery.findMany({
      select: { id: true },
      where: { state: { in: [...active] } },
    })
  ).map(({ id }) => id)
  const received = await database.gitHubWebhookDelivery.findMany({
    select: { id: true },
    where: { id: { in: activeIds } },
  })
  await database.gitHubWebhookRedelivery.updateMany({
    data: { state: "succeeded", failureCode: null },
    where: {
      id: { in: [...deliveredIds, ...received.map(({ id }) => id)] },
      state: { in: [...active] },
    },
  })
  await database.gitHubWebhookRedelivery.updateMany({
    data: { state: "failed", failureCode: "window_expired" },
    where: { expiresAt: { lte: now }, state: { in: [...active] } },
  })
  await database.gitHubWebhookRedelivery.updateMany({
    data: { state: "failed", failureCode: "attempts_exhausted" },
    where: { attempts: { gte: maximumAttempts }, retryAt: { lte: now }, state: "waiting" },
  })
}
