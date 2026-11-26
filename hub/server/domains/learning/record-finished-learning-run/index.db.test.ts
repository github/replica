import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { finishLearningRun } from "../../../repositories/learning-runs/finish-learning-run"
import { listLearningActivityDays } from "../../../repositories/learning-activity-days/list-learning-activity-days"
import { recordFinishedLearningRun } from "."

describe("recordFinishedLearningRun()", () => {
  it("keeps a day's activity after its runs are deleted and counts each run once", async () => {
    const repositoryId = randomUUID()
    const userId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/activity", defaultBranch: "main" },
    })
    await prisma.user.create({ data: { id: userId } })
    await prisma.userProfile.create({
      data: { userId, provider: "github", login: "mona", name: "Mona" },
    })
    const scheduled = await prisma.learningRun.create({
      data: {
        repositoryId,
        scheduled: true,
        state: "RUNNING",
        snapshotDigest: `sha256:${"a".repeat(64)}`,
        startedAt: new Date("2026-12-21T09:00:00Z"),
        commentsConsidered: 5,
        commentsLabeled: 3,
      },
    })
    function succeed(runId: string) {
      return recordFinishedLearningRun(prisma, runId, (transaction) =>
        finishLearningRun(transaction, runId, {
          state: "SUCCEEDED",
          suggestions: 1,
          suggestionsRemaining: 0,
          finishedAt: new Date("2026-12-22T00:10:00Z"),
        }),
      )
    }

    await succeed(scheduled.id)
    const requested = await prisma.learningRun.create({
      data: {
        repositoryId,
        requestedById: userId,
        state: "RUNNING",
        snapshotDigest: `sha256:${"b".repeat(64)}`,
        startedAt: new Date("2026-12-21T23:30:00Z"),
        commentsConsidered: 2,
        commentsLabeled: 1,
      },
    })
    await recordFinishedLearningRun(prisma, requested.id, (transaction) =>
      finishLearningRun(transaction, requested.id, {
        state: "FAILED",
        failureCode: "copilot_refused",
        failureSummary: "Copilot refused the credential.",
        finishedAt: new Date("2026-12-22T00:10:00Z"),
      }),
    )
    await expect(succeed(requested.id)).resolves.toEqual({ count: 0 })
    await prisma.learningRun.deleteMany({ where: { repositoryId } })

    await expect(
      listLearningActivityDays(prisma, repositoryId, new Date("2026-01-01")),
    ).resolves.toEqual([
      {
        date: "2026-12-21",
        runState: "failed",
        startedAt: "2026-12-21T23:30:00.000Z",
        startedBy: { type: "user", login: "mona" },
        commentsAnalyzed: 7,
        commentsTagged: 4,
        suggestions: 1,
      },
    ])
  })
})
