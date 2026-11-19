import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Returns which delivery IDs the Hub has already received and processed. */
export async function listClaimedGitHubWebhookDeliveries(
  database: Pick<PrismaClient, "gitHubWebhookDelivery">,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const claimed = await database.gitHubWebhookDelivery.findMany({
    select: { id: true },
    where: { id: { in: ids } },
  })
  return new Set(claimed.map(({ id }) => id))
}
