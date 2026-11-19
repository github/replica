import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Removes finished redelivery records last changed before the cutoff. */
export async function deleteSettledGitHubWebhookRedeliveries(
  database: Pick<PrismaClient, "gitHubWebhookRedelivery">,
  { before }: { before: Date },
): Promise<void> {
  await database.gitHubWebhookRedelivery.deleteMany({
    where: { state: { in: ["succeeded", "failed"] }, updatedAt: { lt: before } },
  })
}
