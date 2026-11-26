import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { closeAbandonedLearningUpdateRuns } from "."

describe("closeAbandonedLearningUpdateRuns", () => {
  it("closes unfinished checks as interrupted and leaves finished ones alone", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/learning", defaultBranch: "main" },
    })
    const stale = await prisma.learningUpdateRun.create({
      data: { repositoryId: repository.id, memoryId: "memory-1" },
    })
    const finished = await prisma.learningUpdateRun.create({
      data: {
        repositoryId: repository.id,
        memoryId: "memory-2",
        state: "SUCCEEDED",
        result: "no_change",
      },
    })
    const finishedAt = new Date("2026-12-27T03:00:00Z")

    await closeAbandonedLearningUpdateRuns(prisma, finishedAt)

    const runs = await prisma.learningUpdateRun.findMany({
      select: { id: true, state: true, failureCode: true, finishedAt: true },
    })
    expect(runs).toEqual(
      expect.arrayContaining([
        { id: stale.id, state: "FAILED", failureCode: "interrupted", finishedAt },
        { id: finished.id, state: "SUCCEEDED", failureCode: null, finishedAt: null },
      ]),
    )
  })
})
