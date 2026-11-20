import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { readCanvasEvaluationContext } from "."

async function createPrototype(
  repositoryId: string,
  branchName: string,
  overrides: {
    branchDeletedAt?: Date
    registeredAt?: Date | null
    replica?: boolean
  } = {},
) {
  return prisma.prototype.create({
    data: {
      repositoryId,
      branchName,
      name: branchName,
      registeredAt:
        overrides.registeredAt === undefined
          ? new Date("2026-11-01T00:00:00.000Z")
          : overrides.registeredAt,
      ...overrides,
    },
  })
}

async function createBuild(
  prototypeId: string,
  number: number,
  commitSha: string,
  overrides: {
    state?: "queued" | "running" | "failed" | "successful" | "superseded"
    finishedAt?: Date | null
  } = {},
) {
  const state = overrides.state ?? "successful"
  const finishedAt =
    overrides.finishedAt === undefined ? new Date("2026-11-02T00:01:00.000Z") : overrides.finishedAt
  return prisma.build.create({
    data: {
      prototypeId,
      number,
      commitSha,
      state,
      startedAt: finishedAt ? new Date("2026-11-02T00:00:00.000Z") : null,
      finishedAt,
    },
  })
}

describe("readCanvasEvaluationContext()", () => {
  it("returns the active prototype and exact successful published Build for the checkout", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/evaluation-context", defaultBranch: "main" },
    })
    const prototype = await createPrototype(repository.id, "prototype/critic")
    const commitSha = "a".repeat(40)
    const build = await createBuild(prototype.id, 1, commitSha)
    await createBuild(prototype.id, 2, "b".repeat(40))

    await expect(
      readCanvasEvaluationContext(prisma, repository.id, prototype.branchName, commitSha),
    ).resolves.toEqual({ id: prototype.id, builds: [{ id: build.id }] })
  })

  it("returns the prototype without a Build when the checkout commit is not published", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/unpublished-context", defaultBranch: "main" },
    })
    const prototype = await createPrototype(repository.id, "prototype/unpublished")
    await createBuild(prototype.id, 1, "b".repeat(40))

    await expect(
      readCanvasEvaluationContext(prisma, repository.id, prototype.branchName, "a".repeat(40)),
    ).resolves.toEqual({ id: prototype.id, builds: [] })
  })

  it("does not treat failed or unfinished Builds as published", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/incomplete-context", defaultBranch: "main" },
    })
    const failedPrototype = await createPrototype(repository.id, "prototype/failed")
    const unfinishedPrototype = await createPrototype(repository.id, "prototype/unfinished")
    const failedCommit = "c".repeat(40)
    const unfinishedCommit = "d".repeat(40)
    await createBuild(failedPrototype.id, 1, failedCommit, { state: "failed" })
    await createBuild(unfinishedPrototype.id, 1, unfinishedCommit, {
      finishedAt: null,
    })

    await expect(
      readCanvasEvaluationContext(prisma, repository.id, failedPrototype.branchName, failedCommit),
    ).resolves.toEqual({ id: failedPrototype.id, builds: [] })
    await expect(
      readCanvasEvaluationContext(
        prisma,
        repository.id,
        unfinishedPrototype.branchName,
        unfinishedCommit,
      ),
    ).resolves.toEqual({ id: unfinishedPrototype.id, builds: [] })
  })

  it("hides retired and replica prototypes from evaluation authorization", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/hidden-context", defaultBranch: "main" },
    })
    const retired = await createPrototype(repository.id, "prototype/retired", {
      branchDeletedAt: new Date("2026-11-03T00:00:00.000Z"),
    })
    const replica = await createPrototype(repository.id, "prototype/replica", {
      registeredAt: null,
      replica: true,
    })

    await expect(
      readCanvasEvaluationContext(prisma, repository.id, retired.branchName, "a".repeat(40)),
    ).resolves.toBeNull()
    await expect(
      readCanvasEvaluationContext(prisma, repository.id, replica.branchName, "b".repeat(40)),
    ).resolves.toBeNull()
  })
})
