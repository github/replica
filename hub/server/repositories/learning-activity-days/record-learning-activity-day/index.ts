import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Adds a finished run to its day's activity summary. Runs are deleted after 90 days,
 * so this summary is what keeps a year of activity. The day is the UTC date the run
 * started, or was created when it never started.
 */
export async function recordLearningActivityDay(
  database: Pick<Prisma.TransactionClient, "learningRun" | "learningActivityDay">,
  runId: string,
) {
  const run = await database.learningRun.findUniqueOrThrow({ where: { id: runId } })
  const startedAt = run.startedAt ?? run.createdAt
  const date = new Date(`${startedAt.toISOString().slice(0, 10)}T00:00:00.000Z`)
  const last = {
    lastRunState: run.state,
    lastScheduled: run.scheduled,
    lastStartedAt: startedAt,
    lastRequestedById: run.requestedById,
  }
  await database.learningActivityDay.upsert({
    where: { repositoryId_date: { repositoryId: run.repositoryId, date } },
    create: {
      repositoryId: run.repositoryId,
      date,
      runs: 1,
      commentsAnalyzed: run.commentsConsidered,
      commentsTagged: run.commentsLabeled,
      suggestions: run.suggestions,
      ...last,
    },
    update: {
      runs: { increment: 1 },
      commentsAnalyzed: { increment: run.commentsConsidered },
      commentsTagged: { increment: run.commentsLabeled },
      suggestions: { increment: run.suggestions },
      ...last,
    },
  })
}
