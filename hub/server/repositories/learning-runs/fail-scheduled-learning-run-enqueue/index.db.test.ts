import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { failScheduledLearningRunEnqueue } from "."

describe("failScheduledLearningRunEnqueue()", () => {
  it("does not fail a scheduled run after a user request promotes it", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/promoted", defaultBranch: "main" },
    })
    const run = await prisma.learningRun.create({
      data: {
        repositoryId,
        scheduled: false,
        snapshotDigest: `sha256:${"a".repeat(64)}`,
      },
    })

    await expect(
      failScheduledLearningRunEnqueue(prisma, run.id, new Date("2026-11-18T10:00:00Z")),
    ).resolves.toEqual({ count: 0 })
    await expect(
      prisma.learningRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).resolves.toMatchObject({ state: "QUEUED", scheduled: false })
  })
})
