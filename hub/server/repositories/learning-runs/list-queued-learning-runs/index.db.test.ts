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

  it("keeps a newer user run visible behind a full page of automatic runs", async () => {
    const repositories = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(),
      nameWithOwner: `team/recovery-${index}`,
      defaultBranch: "main",
    }))
    await prisma.repository.createMany({ data: repositories })
    await prisma.learningRun.createMany({
      data: repositories.slice(0, 100).map((repository, index) => ({
        repositoryId: repository.id,
        scheduled: true,
        snapshotDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
        createdAt: new Date(Date.UTC(2026, 10, 18, 8, index)),
      })),
    })
    const userRun = await prisma.learningRun.create({
      data: {
        repositoryId: repositories[100]!.id,
        snapshotDigest: `sha256:${"f".repeat(64)}`,
        createdAt: new Date("2026-11-18T12:00:00Z"),
      },
    })

    const recoverable = await listQueuedLearningRuns(prisma)

    expect(recoverable).toHaveLength(100)
    expect(recoverable[0]).toEqual({ id: userRun.id, scheduled: false })
    expect(recoverable.filter((run) => run.scheduled)).toHaveLength(99)
  })
})
