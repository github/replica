import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { listReadyLearningScoreRequests } from "."

describe("listReadyLearningScoreRequests()", () => {
  it("finds built commits past a page of commits that never built", async () => {
    const built = "a".repeat(40)
    const unbuilt = "b".repeat(40)
    const repository = await prisma.repository.create({
      data: {
        nameWithOwner: "team/scored",
        defaultBranch: "main",
        evaluationSetting: { create: { enabled: true, evaluationGrantId: "evaluation_1" } },
      },
    })
    const other = await prisma.repository.create({
      data: {
        nameWithOwner: "team/other",
        defaultBranch: "main",
        evaluationSetting: { create: { enabled: true, evaluationGrantId: "evaluation_1" } },
      },
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
        startedAt: new Date("2026-12-01T00:00:00Z"),
        finishedAt: new Date("2026-12-01T00:01:00Z"),
      },
    })
    await prisma.learningScoreRequest.createMany({
      // IDs fix the reading order, so the unbuilt requests fill the first pages.
      data: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          repositoryId: repository.id,
          commitSha: unbuilt,
        },
        { id: "00000000-0000-4000-8000-000000000002", repositoryId: other.id, commitSha: built },
        {
          id: "00000000-0000-4000-8000-000000000003",
          repositoryId: repository.id,
          commitSha: built,
        },
      ],
    })

    await expect(listReadyLearningScoreRequests(prisma, 1)).resolves.toEqual([
      { repositoryId: repository.id, commitSha: built },
    ])
  })
})
