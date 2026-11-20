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
    const runId = BigInt(input.runId)
    const build = await transaction.build.findFirst({
      where: {
        OR: [
          { githubWorkflowRunId: runId },
          { githubRunCompletions: { some: { githubWorkflowRunId: runId } } },
        ],
        prototype: { repository: { githubRepositoryId: BigInt(input.githubRepositoryId) } },
      },
      select: {
        state: true,
        githubWorkflowRunId: true,
        githubWorkflowRunAttempt: true,
        workflowCompletedAt: true,
        githubRunCompletions: {
          where: { githubWorkflowRunId: runId },
          select: { runAttempt: true, completedAt: true },
        },
      },
    })
    const owningAttempt =
      build?.githubWorkflowRunId === runId ? build.githubWorkflowRunAttempt : null
    let completion = build?.githubRunCompletions[0] ?? null
    if (
      owningAttempt !== null &&
      build?.workflowCompletedAt &&
      (!completion || owningAttempt > completion.runAttempt)
    ) {
      completion = { runAttempt: owningAttempt, completedAt: build.workflowCompletedAt }
    }
    return {
      receipt,
      redelivery,
      build: build
        ? {
            state: build.state,
            owningAttempt,
            completedAttempt: completion?.runAttempt ?? null,
            completedAt: completion?.completedAt ?? null,
          }
        : null,
    }
  })
}
