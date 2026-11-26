import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { sumLearningEvaluationCredits } from "."

describe("sumLearningEvaluationCredits()", () => {
  it("counts update suggestions against the same monthly budget as scoring", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/learning", defaultBranch: "main" },
    })
    const since = new Date("2026-12-01T00:00:00Z")
    await prisma.learningEvaluationRun.create({
      data: {
        repositoryId: repository.id,
        usedLearningId: "used-1",
        operationId: "00000000-0000-4000-8000-000000000001",
        aiCredits: "1.25",
        finishedAt: new Date("2026-12-02T00:00:00Z"),
      },
    })
    await prisma.learningUpdateRun.createMany({
      data: [
        {
          repositoryId: repository.id,
          memoryId: "memory-1",
          aiCredits: "0.5",
          finishedAt: new Date("2026-12-03T00:00:00Z"),
        },
        {
          repositoryId: repository.id,
          memoryId: "memory-1",
          aiCredits: "9",
          finishedAt: new Date("2026-11-30T00:00:00Z"),
        },
      ],
    })

    expect((await sumLearningEvaluationCredits(prisma, since))?.toString()).toBe("1.75")
  })
})
