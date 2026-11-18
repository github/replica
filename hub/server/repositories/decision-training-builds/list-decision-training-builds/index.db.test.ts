import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { listDecisionTrainingBuilds } from "."

async function createRepository(name: string, removedAt: Date | null = null) {
  return prisma.repository.create({
    data: { nameWithOwner: `team/${name}`, defaultBranch: "main", removedAt },
  })
}

async function createReviewedPrototype(
  repositoryId: string,
  input: {
    branchName: string
    registeredAt?: Date | null
    branchDeletedAt?: Date | null
    reviewed?: boolean
    createdAt?: Date
  },
) {
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId,
      branchName: input.branchName,
      name: input.branchName,
      registeredAt:
        input.registeredAt === undefined
          ? new Date("2026-01-01T00:00:00.000Z")
          : input.registeredAt,
      branchDeletedAt: input.branchDeletedAt,
      createdAt: input.createdAt,
    },
  })
  if (input.reviewed !== false) {
    const build = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 99,
        state: "successful",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:01:00.000Z"),
      },
    })
    await prisma.reviewThread.create({
      data: {
        repositoryId,
        prototypeId: prototype.id,
        buildId: build.id,
        anchor: { kind: "area", route: { pathname: "/" } },
      },
    })
  }
  return prototype
}

async function createBuild(
  prototypeId: string,
  input: {
    number: number
    state?: "queued" | "running" | "failed" | "successful" | "superseded"
    workflowCreatedAt?: Date | null
    finishedAt?: Date | null
    artifacts?: "complete" | "manifest-only" | "screenshot-only" | "none"
  },
) {
  const state = input.state ?? "successful"
  const finishedAt =
    input.finishedAt === undefined ? new Date("2026-01-10T00:00:00.000Z") : input.finishedAt
  const build = await prisma.build.create({
    data: {
      prototypeId,
      number: input.number,
      state,
      workflowCreatedAt: input.workflowCreatedAt,
      startedAt:
        finishedAt && ["failed", "successful"].includes(state)
          ? new Date("2026-01-09T00:00:00.000Z")
          : null,
      finishedAt,
    },
  })
  const artifacts = input.artifacts ?? "complete"
  const data = []
  if (artifacts === "complete" || artifacts === "manifest-only") {
    data.push({
      buildId: build.id,
      kind: "manifest" as const,
      path: "templates.json",
      storageKey: randomUUID(),
      byteLength: 10,
    })
  }
  if (artifacts === "complete" || artifacts === "screenshot-only") {
    data.push({
      buildId: build.id,
      kind: "screenshot" as const,
      path: "screenshots/desktop.png",
      storageKey: randomUUID(),
      byteLength: 20,
    })
  }
  if (data.length) await prisma.buildArtifact.createMany({ data })
  return build
}

describe("listDecisionTrainingBuilds()", () => {
  it("returns only the requested repository's reviewed active prototypes and screenshot-bearing published Builds", async () => {
    const repository = await createRepository("selected")
    const otherRepository = await createRepository("other")
    const eligible = await createReviewedPrototype(repository.id, { branchName: "eligible" })
    const deleted = await createReviewedPrototype(repository.id, {
      branchName: "deleted",
      branchDeletedAt: new Date("2026-01-02T00:00:00.000Z"),
    })
    const unregistered = await createReviewedPrototype(repository.id, {
      branchName: "unregistered",
      registeredAt: null,
    })
    const unreviewed = await createReviewedPrototype(repository.id, {
      branchName: "unreviewed",
      reviewed: false,
    })
    const crossRepository = await createReviewedPrototype(otherRepository.id, {
      branchName: "other-repository",
    })
    const included = await createBuild(eligible.id, { number: 1 })
    await createBuild(eligible.id, { number: 2, state: "failed" })
    await createBuild(eligible.id, { number: 3, finishedAt: null })
    await createBuild(eligible.id, { number: 4, artifacts: "manifest-only" })
    const rootOnly = await createBuild(eligible.id, {
      number: 5,
      artifacts: "screenshot-only",
    })
    await createBuild(eligible.id, { number: 6, artifacts: "none" })
    await createBuild(deleted.id, { number: 1 })
    await createBuild(unregistered.id, { number: 1 })
    await createBuild(unreviewed.id, { number: 1 })
    await createBuild(crossRepository.id, { number: 1 })

    const result = await listDecisionTrainingBuilds(prisma, repository.id, {
      prototypes: 20,
      buildsPerPrototype: 20,
    })

    expect(result?.id).toBe(repository.id)
    expect(result?.prototypes.map(({ id }) => id)).toEqual([eligible.id])
    expect(result?.prototypes[0]?.builds.map(({ id }) => id)).toEqual([included.id, rootOnly.id])
    expect(result?.prototypes[0]?.builds[0]?.artifacts.map(({ kind }) => kind).sort()).toEqual([
      "manifest",
      "screenshot",
    ])
    expect(result?.prototypes[0]?.builds[1]?.artifacts.map(({ kind }) => kind)).toEqual([
      "screenshot",
    ])
  })

  it("orders Builds by workflow creation time, then Build number, without crossing prototypes", async () => {
    const repository = await createRepository("chronological")
    const firstPrototype = await createReviewedPrototype(repository.id, {
      branchName: "first",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    })
    const secondPrototype = await createReviewedPrototype(repository.id, {
      branchName: "second",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    })
    const laterNumber = await createBuild(firstPrototype.id, {
      number: 20,
      workflowCreatedAt: new Date("2026-01-03T00:00:00.000Z"),
    })
    const earlierNumber = await createBuild(firstPrototype.id, {
      number: 30,
      workflowCreatedAt: new Date("2026-01-02T00:00:00.000Z"),
    })
    const sameTimeLowerNumber = await createBuild(firstPrototype.id, {
      number: 10,
      workflowCreatedAt: new Date("2026-01-03T00:00:00.000Z"),
    })
    const otherBuild = await createBuild(secondPrototype.id, {
      number: 1,
      workflowCreatedAt: new Date("2025-01-01T00:00:00.000Z"),
    })

    const result = await listDecisionTrainingBuilds(prisma, repository.id, {
      prototypes: 20,
      buildsPerPrototype: 20,
    })

    expect(result?.prototypes.map(({ id }) => id)).toEqual([firstPrototype.id, secondPrototype.id])
    expect(result?.prototypes[0]?.builds.map(({ id }) => id)).toEqual([
      earlierNumber.id,
      sameTimeLowerNumber.id,
      laterNumber.id,
    ])
    expect(result?.prototypes[1]?.builds.map(({ id }) => id)).toEqual([otherBuild.id])
  })

  it("does not expose a removed repository", async () => {
    const repository = await createRepository("removed", new Date("2026-01-03T00:00:00.000Z"))
    const prototype = await createReviewedPrototype(repository.id, { branchName: "reviewed" })
    await createBuild(prototype.id, { number: 1 })

    await expect(
      listDecisionTrainingBuilds(prisma, repository.id, {
        prototypes: 20,
        buildsPerPrototype: 20,
      }),
    ).resolves.toBeNull()
  })
})
