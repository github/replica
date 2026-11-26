import type { Prisma } from "../../../generated/prisma/client.ts"

/** Lists a repository's daily learning activity from a UTC date onward. */
export async function listLearningActivityDays(
  database: Pick<Prisma.TransactionClient, "learningActivityDay">,
  repositoryId: string,
  from: Date,
) {
  const days = await database.learningActivityDay.findMany({
    where: { repositoryId, date: { gte: from } },
    include: { lastRequestedBy: { include: { profile: true } } },
    orderBy: { date: "asc" },
  })
  return days.map((day) => ({
    date: day.date.toISOString().slice(0, 10),
    runState: day.lastRunState === "FAILED" ? ("failed" as const) : ("succeeded" as const),
    startedAt: day.lastStartedAt.toISOString(),
    startedBy: day.lastScheduled
      ? ({ type: "daily" } as const)
      : day.lastRequestedBy?.profile?.login
        ? ({ type: "user", login: day.lastRequestedBy.profile.login } as const)
        : ({ type: "unknown" } as const),
    commentsAnalyzed: day.commentsAnalyzed,
    commentsTagged: day.commentsTagged,
    suggestions: day.suggestions,
  }))
}
