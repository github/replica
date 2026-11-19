import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { NewGitHubWebhookRedelivery } from "../types.ts"

/** Records missed deliveries once; a delivery that is already tracked keeps its state. */
export async function createGitHubWebhookRedeliveries(
  database: Pick<PrismaClient, "gitHubWebhookRedelivery">,
  redeliveries: NewGitHubWebhookRedelivery[],
): Promise<number> {
  if (redeliveries.length === 0) return 0
  const { count } = await database.gitHubWebhookRedelivery.createMany({
    data: redeliveries.map((redelivery) => ({
      ...redelivery,
      githubDeliveryId: BigInt(redelivery.githubDeliveryId),
    })),
    skipDuplicates: true,
  })
  return count
}
