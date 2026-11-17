import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { updateLearningRunProgress } from "../update-learning-run-progress"
import { listLearningRuns } from "."

describe("listLearningRuns()", () => {
  it("returns recent state and sums decimal usage from the previous 30 days", async () => {
    const repositoryId = randomUUID()
    const userId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.user.create({ data: { id: userId } })
    await prisma.userProfile.create({
      data: { userId, provider: "github", login: "mona", name: "Mona" },
    })
    await prisma.learningRun.createMany({
      data: [
        {
          repositoryId,
          snapshotDigest: `sha256:${"a".repeat(64)}`,
          requestedById: userId,
          state: "SUCCEEDED",
          startedAt: new Date("2026-11-12T10:00:00Z"),
          finishedAt: new Date("2026-11-12T10:10:00Z"),
          commentsConsidered: 4,
          commentsLabeled: 2,
          suggestions: 1,
          copilotRequests: 1,
          aiCredits: "0.021",
          createdAt: new Date("2026-11-12T10:00:00Z"),
        },
        {
          repositoryId,
          snapshotDigest: `sha256:${"b".repeat(64)}`,
          scheduled: true,
          state: "FAILED",
          failureCode: "copilot_refused",
          failureSummary: "Copilot refused the credential.",
          finishedAt: new Date("2026-09-01T10:01:00Z"),
          copilotRequests: 1,
          aiCredits: "0.5",
          createdAt: new Date("2026-09-01T10:00:00Z"),
        },
      ],
    })

    const result = await listLearningRuns(prisma, repositoryId, new Date("2026-11-13T10:00:00Z"))

    expect(result.usageCredits).toBe("0.021")
    expect(result.active).toBe(false)
    expect(result.runs).toHaveLength(2)
    expect(result.runs[0]?.startedBy).toEqual({ type: "user", login: "mona" })
    expect(result.runs[0]?.state).toBe("succeeded")
    expect(result.runs[0]?.result?.type).toBe("succeeded")
    if (result.runs[0]?.result?.type !== "succeeded") throw new Error("Expected success result.")
    expect(result.runs[0].result.commentsConsidered).toBe(4)
    expect(result.runs[0]?.usage).toEqual({ credits: "0.021", requests: 1 })
    expect(result.runs[1]?.startedBy).toEqual({ type: "daily" })
    expect(result.runs[1]?.state).toBe("failed")
    expect(result.runs[1]?.result).toEqual({
      type: "failed",
      summary: "Copilot refused the credential.",
    })
  })

  it("allows only one queued or running record for a repository", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.learningRun.create({
      data: { repositoryId, snapshotDigest: `sha256:${"a".repeat(64)}` },
    })

    await expect(
      prisma.learningRun.create({
        data: {
          repositoryId,
          snapshotDigest: `sha256:${"b".repeat(64)}`,
          state: "RUNNING",
          startedAt: new Date(),
        },
      }),
    ).rejects.toThrow()
  })

  it("accumulates recovered labeling work without replacing earlier usage", async () => {
    const repositoryId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const run = await prisma.learningRun.create({
      data: {
        repositoryId,
        snapshotDigest: `sha256:${"a".repeat(64)}`,
        state: "RUNNING",
        startedAt: new Date(),
        commentsConsidered: 4,
        commentsLabeled: 3,
        commentsRemaining: 2,
        copilotRequests: 1,
        aiCredits: "0.001",
      },
    })
    await updateLearningRunProgress(prisma, run.id, {
      commentsConsidered: 2,
      commentsLabeled: 1,
      commentsRemaining: 0,
      copilotRequests: 1,
      aiCredits: "0.0025",
    })

    const updated = await prisma.learningRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updated).toMatchObject({
      commentsConsidered: 6,
      commentsLabeled: 4,
      commentsRemaining: 0,
      copilotRequests: 2,
    })
    expect(updated.aiCredits.toString()).toBe("0.0035")
  })
})
