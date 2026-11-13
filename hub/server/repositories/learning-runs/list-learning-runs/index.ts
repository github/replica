import type { Prisma } from "../../../generated/prisma/client.ts"

export async function listLearningRuns(
  database: Pick<Prisma.TransactionClient, "learningRun">,
  repositoryId: string,
  now: Date,
) {
  const [records, usage] = await Promise.all([
    database.learningRun.findMany({
      where: { repositoryId },
      include: { requestedBy: { include: { profile: true } } },
      orderBy: [{ createdAt: "desc" }, { number: "desc" }],
      take: 10,
    }),
    database.learningRun.aggregate({
      where: {
        repositoryId,
        startedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
      },
      _sum: { aiCredits: true },
    }),
  ])
  return {
    active: records.some((record) => record.state === "QUEUED" || record.state === "RUNNING"),
    usageCredits: usage._sum.aiCredits?.toString() ?? "0",
    runs: records.map((record) => ({
      id: record.number,
      startedAt: (record.startedAt ?? record.createdAt).toISOString(),
      startedBy: record.scheduled
        ? ({ type: "daily" } as const)
        : record.requestedBy?.profile?.login
          ? ({ type: "user", login: record.requestedBy.profile.login } as const)
          : ({ type: "unknown" } as const),
      state: record.state.toLowerCase() as "queued" | "running" | "succeeded" | "failed",
      result:
        record.state === "SUCCEEDED"
          ? {
              type: "succeeded" as const,
              commentsConsidered: record.commentsConsidered,
              commentsLabeled: record.commentsLabeled,
              commentsRemaining: record.commentsRemaining,
              suggestions: record.suggestions,
              suggestionsRemaining: record.suggestionsRemaining,
            }
          : record.state === "FAILED"
            ? {
                type: "failed" as const,
                summary: record.failureSummary ?? "Hub could not finish this learning run.",
              }
            : null,
      usage:
        record.copilotRequests > 0
          ? { credits: record.aiCredits.toString(), requests: record.copilotRequests }
          : null,
    })),
  }
}
