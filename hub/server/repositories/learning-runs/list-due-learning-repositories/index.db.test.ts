import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { listDueLearningRepositories } from "."

async function createReviewEvidence(input: { repositoryId: string; updatedAt: Date }) {
  const author = await prisma.user.create({ data: {} })
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId: input.repositoryId,
      branchName: `prototype-${randomUUID()}`,
    },
  })
  const build = await prisma.build.create({
    data: {
      prototypeId: prototype.id,
      number: 1,
      state: "successful",
      startedAt: input.updatedAt,
      finishedAt: input.updatedAt,
    },
  })
  await prisma.reviewThread.create({
    data: {
      repositoryId: input.repositoryId,
      prototypeId: prototype.id,
      buildId: build.id,
      anchor: { schemaVersion: 1, kind: "element", selector: "#content" },
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
      comments: {
        create: {
          authorId: author.id,
          authorLogin: "mona",
          body: "Review evidence",
          createdAt: input.updatedAt,
          updatedAt: input.updatedAt,
        },
      },
    },
  })
}

describe("listDueLearningRepositories()", () => {
  it("orders never and least-recently-run repositories while excluding unavailable and active ones", async () => {
    const neverRunId = "11111111-1111-4111-8111-111111111111"
    const olderRunId = "22222222-2222-4222-8222-222222222222"
    const newerRunId = "33333333-3333-4333-8333-333333333333"
    const removedId = "44444444-4444-4444-8444-444444444444"
    const disconnectedId = "55555555-5555-4555-8555-555555555555"
    const activeId = "66666666-6666-4666-8666-666666666666"
    await prisma.repository.createMany({
      data: [
        {
          id: neverRunId,
          githubRepositoryId: 101,
          nameWithOwner: "team/never",
          defaultBranch: "main",
        },
        {
          id: olderRunId,
          githubRepositoryId: 102,
          nameWithOwner: "team/older",
          defaultBranch: "main",
        },
        {
          id: newerRunId,
          githubRepositoryId: 103,
          nameWithOwner: "team/newer",
          defaultBranch: "main",
        },
        {
          id: removedId,
          githubRepositoryId: 104,
          nameWithOwner: "team/removed",
          defaultBranch: "main",
          removedAt: new Date("2026-11-18T08:00:00Z"),
        },
        {
          id: disconnectedId,
          nameWithOwner: "team/disconnected",
          defaultBranch: "main",
        },
        {
          id: activeId,
          githubRepositoryId: 106,
          nameWithOwner: "team/active",
          defaultBranch: "main",
        },
      ],
    })
    await Promise.all(
      [neverRunId, olderRunId, newerRunId, removedId, disconnectedId, activeId].map(
        (repositoryId) =>
          createReviewEvidence({
            repositoryId,
            updatedAt: new Date("2026-11-18T09:00:00Z"),
          }),
      ),
    )
    await prisma.learningRun.createMany({
      data: [
        {
          repositoryId: olderRunId,
          scheduled: true,
          state: "SUCCEEDED",
          snapshotDigest: `sha256:${"a".repeat(64)}`,
          startedAt: new Date("2026-11-17T07:00:00Z"),
          finishedAt: new Date("2026-11-17T08:00:00Z"),
          createdAt: new Date("2026-11-17T07:00:00Z"),
        },
        {
          repositoryId: newerRunId,
          scheduled: true,
          state: "SUCCEEDED",
          snapshotDigest: `sha256:${"b".repeat(64)}`,
          startedAt: new Date("2026-11-17T09:00:00Z"),
          finishedAt: new Date("2026-11-17T10:00:00Z"),
          createdAt: new Date("2026-11-17T09:00:00Z"),
        },
        {
          repositoryId: activeId,
          scheduled: true,
          state: "RUNNING",
          snapshotDigest: `sha256:${"c".repeat(64)}`,
          startedAt: new Date("2026-11-18T09:30:00Z"),
        },
      ],
    })

    const due = await listDueLearningRepositories(prisma, {
      requireGitHubId: true,
    })

    expect(due.map(({ id }) => id)).toEqual([neverRunId, olderRunId, newerRunId])
  })

  it("uses unfinished work from the latest run even without newer review evidence", async () => {
    const commentsId = randomUUID()
    const suggestionsId = randomUUID()
    const failedAfterSuggestionsId = randomUUID()
    const completeId = randomUUID()
    await prisma.repository.createMany({
      data: [
        { id: commentsId, nameWithOwner: "team/comments", defaultBranch: "main" },
        { id: suggestionsId, nameWithOwner: "team/suggestions", defaultBranch: "main" },
        {
          id: failedAfterSuggestionsId,
          nameWithOwner: "team/failed-after-suggestions",
          defaultBranch: "main",
        },
        { id: completeId, nameWithOwner: "team/complete", defaultBranch: "main" },
      ],
    })
    await prisma.learningRun.createMany({
      data: [
        {
          repositoryId: commentsId,
          state: "FAILED",
          commentsRemaining: 2,
          snapshotDigest: `sha256:${"a".repeat(64)}`,
          failureCode: "failed",
          failureSummary: "Hub could not finish this run.",
          finishedAt: new Date("2026-11-18T08:00:00Z"),
        },
        {
          repositoryId: suggestionsId,
          state: "SUCCEEDED",
          suggestionsRemaining: 1,
          snapshotDigest: `sha256:${"b".repeat(64)}`,
          startedAt: new Date("2026-11-18T07:00:00Z"),
          finishedAt: new Date("2026-11-18T08:00:00Z"),
        },
        {
          repositoryId: completeId,
          state: "SUCCEEDED",
          snapshotDigest: `sha256:${"c".repeat(64)}`,
          startedAt: new Date("2026-11-18T07:00:00Z"),
          finishedAt: new Date("2026-11-18T08:00:00Z"),
        },
        {
          repositoryId: failedAfterSuggestionsId,
          state: "SUCCEEDED",
          suggestionsRemaining: 2,
          snapshotDigest: `sha256:${"d".repeat(64)}`,
          startedAt: new Date("2026-11-17T07:00:00Z"),
          finishedAt: new Date("2026-11-17T08:00:00Z"),
          createdAt: new Date("2026-11-17T07:00:00Z"),
        },
        {
          repositoryId: failedAfterSuggestionsId,
          state: "FAILED",
          snapshotDigest: `sha256:${"e".repeat(64)}`,
          failureCode: "copilot_not_connected",
          failureSummary: "Copilot is not connected.",
          finishedAt: new Date("2026-11-18T08:00:00Z"),
          createdAt: new Date("2026-11-18T07:00:00Z"),
        },
      ],
    })

    const due = await listDueLearningRepositories(prisma, {
      requireGitHubId: false,
    })

    expect(new Set(due.map(({ id }) => id))).toEqual(
      new Set([commentsId, suggestionsId, failedAfterSuggestionsId]),
    )
  })
})
