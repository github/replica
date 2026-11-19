import type { PrismaClient } from "../../../generated/prisma/client.ts"

/** Records the result of a claimed request, unless another worker has since reclaimed it. */
export async function recordGitHubWebhookRedeliveryAttempt(
  database: Pick<PrismaClient, "gitHubWebhookRedelivery">,
  {
    attempts,
    failureCode,
    id,
    retryAt,
  }: { attempts: number; failureCode: string | null; id: string; retryAt: Date },
): Promise<void> {
  await database.gitHubWebhookRedelivery.updateMany({
    data: { failureCode, retryAt, state: "waiting" },
    where: { attempts, id, state: "requesting" },
  })
}
