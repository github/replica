import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Lists commits an agent reported learning usage for that are ready to score: their
 * repository is still connected and can be evaluated, and the commit has a successful
 * Build there. The
 * Build can land before or after the report, so either order ends up here. Requests are
 * read in pages, so a pile of commits that never build can't hide ones that did.
 */
export async function listReadyLearningScoreRequests(
  database: Pick<PrismaClient, "build" | "learningScoreRequest">,
  limit = 100,
) {
  const ready: Array<{ repositoryId: string; commitSha: string }> = []
  let cursor: string | undefined
  while (ready.length < limit) {
    const requests = await database.learningScoreRequest.findMany({
      where: {
        repository: {
          removedAt: null,
          evaluationSetting: { enabled: true, evaluationGrantId: { not: null } },
        },
      },
      orderBy: { id: "asc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, repositoryId: true, commitSha: true },
    })
    if (requests.length === 0) break
    cursor = requests.at(-1)!.id
    const builds = await database.build.findMany({
      where: {
        state: "successful",
        commitSha: { in: requests.map((request) => request.commitSha) },
        prototype: { repositoryId: { in: requests.map((request) => request.repositoryId) } },
      },
      select: { commitSha: true, prototype: { select: { repositoryId: true } } },
    })
    const built = new Set(
      builds.map((build) => `${build.prototype.repositoryId}:${build.commitSha}`),
    )
    for (const request of requests) {
      if (built.has(`${request.repositoryId}:${request.commitSha}`)) {
        ready.push({ repositoryId: request.repositoryId, commitSha: request.commitSha })
      }
    }
    if (requests.length < limit) break
  }
  return ready.slice(0, limit)
}
