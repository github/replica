import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function findGitHubWebhookEvidence(
  database: PrismaClient,
  input: { deliveryGuid: string; githubRepositoryId: number; runId: number },
) {
  return database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SET TRANSACTION READ ONLY`
    await transaction.$executeRaw`SET LOCAL statement_timeout = '5s'`
    const receipt = await transaction.gitHubWebhookDelivery.findUnique({
      where: { id: input.deliveryGuid },
      select: { event: true, createdAt: true },
    })
    const redelivery = await transaction.gitHubWebhookRedelivery.findUnique({
      where: { id: input.deliveryGuid },
      select: { state: true, attempts: true, failureCode: true },
    })
    const build = await transaction.build.findFirst({
      where: {
        githubWorkflowRunId: BigInt(input.runId),
        prototype: { repository: { githubRepositoryId: BigInt(input.githubRepositoryId) } },
      },
      select: { state: true, workflowCompletedAt: true },
    })
    return { receipt, redelivery, build }
  })
}
