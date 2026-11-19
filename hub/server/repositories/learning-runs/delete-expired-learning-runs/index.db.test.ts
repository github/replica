import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { deleteExpiredLearningRuns } from "."

describe("deleteExpiredLearningRuns()", () => {
  it("deletes old completed runs while retaining recent and active records", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/retention", defaultBranch: "main" },
    })
    const old = await prisma.learningRun.create({
      data: {
        repositoryId,
        state: "FAILED",
        snapshotDigest: `sha256:${"a".repeat(64)}`,
        failureCode: "failed",
        failureSummary: "Hub could not finish this run.",
        finishedAt: new Date("2026-08-01T10:00:00Z"),
      },
    })
    const recent = await prisma.learningRun.create({
      data: {
        repositoryId,
        state: "SUCCEEDED",
        snapshotDigest: `sha256:${"b".repeat(64)}`,
        startedAt: new Date("2026-11-17T09:00:00Z"),
        finishedAt: new Date("2026-11-17T10:00:00Z"),
      },
    })
    const active = await prisma.learningRun.create({
      data: {
        repositoryId: (
          await prisma.repository.create({
            data: { nameWithOwner: "team/active-retention", defaultBranch: "main" },
          })
        ).id,
        state: "RUNNING",
        snapshotDigest: `sha256:${"c".repeat(64)}`,
        startedAt: new Date("2026-08-01T10:00:00Z"),
      },
    })

    await deleteExpiredLearningRuns(prisma, new Date("2026-08-20T10:00:00Z"))

    const retained = await prisma.learningRun.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    })
    expect(retained.map(({ id }) => id)).toEqual([recent.id, active.id].sort())
    await expect(prisma.learningRun.findUnique({ where: { id: old.id } })).resolves.toBeNull()
  })

  it("retains old scheduling watermarks while pruning older history", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/watermark", defaultBranch: "main" },
    })
    const oldest = await prisma.learningRun.create({
      data: {
        repositoryId,
        state: "SUCCEEDED",
        snapshotDigest: `sha256:${"d".repeat(64)}`,
        startedAt: new Date("2026-01-01T09:00:00Z"),
        finishedAt: new Date("2026-01-01T10:00:00Z"),
        createdAt: new Date("2026-01-01T09:00:00Z"),
      },
    })
    const latestSuccess = await prisma.learningRun.create({
      data: {
        repositoryId,
        state: "SUCCEEDED",
        snapshotDigest: `sha256:${"e".repeat(64)}`,
        startedAt: new Date("2026-02-01T09:00:00Z"),
        finishedAt: new Date("2026-02-01T10:00:00Z"),
        createdAt: new Date("2026-02-01T09:00:00Z"),
      },
    })
    const latestRun = await prisma.learningRun.create({
      data: {
        repositoryId,
        state: "FAILED",
        commentsRemaining: 1,
        snapshotDigest: `sha256:${"f".repeat(64)}`,
        failureCode: "failed",
        failureSummary: "Hub could not finish this run.",
        finishedAt: new Date("2026-03-01T10:00:00Z"),
        createdAt: new Date("2026-03-01T09:00:00Z"),
      },
    })

    await deleteExpiredLearningRuns(prisma, new Date("2026-08-20T10:00:00Z"))

    const retained = await prisma.learningRun.findMany({
      where: { repositoryId },
      select: { id: true },
    })
    expect(new Set(retained.map(({ id }) => id))).toEqual(new Set([latestSuccess.id, latestRun.id]))
    await expect(prisma.learningRun.findUnique({ where: { id: oldest.id } })).resolves.toBeNull()
  })
})
