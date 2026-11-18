import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { listQueuedLearningRuns } from "."

describe("listQueuedLearningRuns()", () => {
  it("returns queue ownership for queued and stalled running recovery", async () => {
    const userRepositoryId = randomUUID()
    const scheduledRepositoryId = randomUUID()
    await prisma.repository.createMany({
      data: [
        {
          id: userRepositoryId,
          nameWithOwner: "team/user-recovery",
          defaultBranch: "main",
        },
        {
          id: scheduledRepositoryId,
          nameWithOwner: "team/scheduled-recovery",
          defaultBranch: "main",
        },
      ],
    })
    const userRun = await prisma.learningRun.create({
      data: {
        repositoryId: userRepositoryId,
        snapshotDigest: `sha256:${"a".repeat(64)}`,
      },
    })
    const scheduledRun = await prisma.learningRun.create({
      data: {
        repositoryId: scheduledRepositoryId,
        scheduled: true,
        state: "RUNNING",
        snapshotDigest: `sha256:${"b".repeat(64)}`,
        startedAt: new Date("2026-11-18T09:00:00Z"),
      },
    })

    const recoverable = await listQueuedLearningRuns(prisma)

    expect(recoverable).toEqual(
      expect.arrayContaining([
        { id: userRun.id, scheduled: false },
        { id: scheduledRun.id, scheduled: true },
      ]),
    )
  })
})
