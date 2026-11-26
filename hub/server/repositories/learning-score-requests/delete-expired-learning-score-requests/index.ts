import type { PrismaClient } from "../../../generated/prisma/client.ts"

/**
 * Drops score requests older than the cutoff whose commit never got a successful Build.
 * Built requests stay, since they may only be waiting for budget or Copilot to return.
 */
export async function deleteExpiredLearningScoreRequests(
  database: Pick<PrismaClient, "build" | "learningScoreRequest">,
  cutoff: Date,
) {
  let cursor: string | undefined
  while (true) {
    const requests = await database.learningScoreRequest.findMany({
      where: { createdAt: { lt: cutoff } },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, repositoryId: true, commitSha: true },
    })
    if (requests.length === 0) return
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
    await database.learningScoreRequest.deleteMany({
      where: {
        id: {
          in: requests
            .filter((request) => !built.has(`${request.repositoryId}:${request.commitSha}`))
            .map((request) => request.id),
        },
      },
    })
    if (requests.length < 100) return
  }
}
