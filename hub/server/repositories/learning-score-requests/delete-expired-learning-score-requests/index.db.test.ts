import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { deleteExpiredLearningScoreRequests } from "."

describe("deleteExpiredLearningScoreRequests()", () => {
  it("keeps old requests whose commit built, since they may be waiting for budget", async () => {
    const built = "a".repeat(40)
    const unbuilt = "b".repeat(40)
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/scored", defaultBranch: "main" },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "empty-state", name: "Empty state" },
    })
    await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        state: "successful",
        commitSha: built,
        startedAt: new Date("2026-11-01T00:00:00Z"),
        finishedAt: new Date("2026-11-01T00:01:00Z"),
      },
    })
    const createdAt = new Date("2026-11-01T00:00:00Z")
    await prisma.learningScoreRequest.createMany({
      data: [
        { repositoryId: repository.id, commitSha: built, createdAt },
        { repositoryId: repository.id, commitSha: unbuilt, createdAt },
      ],
    })

    await deleteExpiredLearningScoreRequests(prisma, new Date("2026-12-01T00:00:00Z"))

    const remaining = await prisma.learningScoreRequest.findMany({ select: { commitSha: true } })
    expect(remaining).toEqual([{ commitSha: built }])
  })
})
