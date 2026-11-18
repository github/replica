import type { Prisma } from "../../../generated/prisma/client.ts"
import type { GitHubWebhookDelivery } from "../types.ts"

export async function claimGitHubWebhookDelivery(
  database: Pick<Prisma.TransactionClient, "gitHubWebhookDelivery">,
  delivery: GitHubWebhookDelivery,
) {
  const created = await database.gitHubWebhookDelivery.createMany({
    data: [delivery],
    skipDuplicates: true,
  })
  if (created.count === 1) return true

  const existing = await database.gitHubWebhookDelivery.findUniqueOrThrow({
    select: { event: true, payloadDigest: true },
    where: { id: delivery.id },
  })
  if (existing.event !== delivery.event || existing.payloadDigest !== delivery.payloadDigest) {
    throw new Error("GitHub webhook delivery ID was reused for a different event.")
  }
  return false
}
