import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import type { BuildState } from "../../../generated/prisma/client"
import { prisma } from "../../../integrations/prisma"
import { findPathPreviewTargets } from "."

async function createRepository() {
  return prisma.repository.create({
    data: {
      githubRepositoryId: 9007199254740993n,
      nameWithOwner: `octo/${randomUUID()}`,
      defaultBranch: "main",
    },
  })
}

async function createBuild(
  repositoryId: string,
  input: {
    branchName?: string
    state?: BuildState
    artifactPath?: string | null
    runId?: bigint
  } = {},
) {
  const prototype = await prisma.prototype.create({
    data: { repositoryId, branchName: input.branchName ?? `proto/${randomUUID()}` },
  })
  const artifactPath = input.artifactPath === undefined ? "dist/index.html" : input.artifactPath
  return prisma.build.create({
    data: {
      prototypeId: prototype.id,
      number: 1,
      state: input.state ?? "successful",
      commitSha: "a".repeat(40),
      githubWorkflowRunId: input.runId ?? 9007199254740995n,
      githubWorkflowRunAttempt: 1,
      artifacts: artifactPath
        ? {
            create: {
              kind: "dist",
              path: artifactPath,
              storageKey: randomUUID(),
              byteLength: 10,
            },
          }
        : undefined,
    },
  })
}

describe("findPathPreviewTargets()", () => {
  it("finds the exact immutable owning run without rounding GitHub identifiers or following a selecting run", async () => {
    const repository = await createRepository()
    const build = await createBuild(repository.id)
    await prisma.prototype.update({
      where: { id: build.prototypeId },
      data: { currentBuildId: build.id, currentBuildRunId: 9007199254740997n },
    })
    await prisma.gitHubBuildRunCompletion.create({
      data: {
        buildId: build.id,
        githubWorkflowRunId: 9007199254740997n,
        runAttempt: 1,
        completedAt: new Date(),
      },
    })

    await expect(
      findPathPreviewTargets(prisma, {
        githubRepositoryId: "9007199254740993",
        githubWorkflowRunId: "9007199254740995",
      }),
    ).resolves.toEqual([
      { buildId: build.id, repository: { id: repository.id, local: false }, template: false },
    ])
    for (const input of [
      { githubRepositoryId: "9007199254740992", githubWorkflowRunId: "9007199254740995" },
      { githubRepositoryId: "9007199254740993", githubWorkflowRunId: "9007199254740994" },
      { githubRepositoryId: "9007199254740993", githubWorkflowRunId: "9007199254740997" },
    ]) {
      await expect(findPathPreviewTargets(prisma, input)).resolves.toEqual([])
    }
  })

  it("requires a successful Build with its entry artifact in a connected repository", async () => {
    const repository = await createRepository()
    const unavailable = [
      await createBuild(repository.id, { state: "running", runId: 101n }),
      await createBuild(repository.id, { state: "failed", runId: 102n }),
      await createBuild(repository.id, { artifactPath: null, runId: 103n }),
      await createBuild(repository.id, { artifactPath: "dist/assets/app.js", runId: 104n }),
    ]

    for (const build of unavailable) {
      await expect(
        findPathPreviewTargets(prisma, {
          githubRepositoryId: "9007199254740993",
          githubWorkflowRunId: String(build.githubWorkflowRunId),
        }),
      ).resolves.toEqual([])
    }

    const removed = await createBuild(repository.id, { runId: 105n })
    await prisma.repository.update({
      where: { id: repository.id },
      data: { removedAt: new Date() },
    })
    await expect(
      findPathPreviewTargets(prisma, {
        githubRepositoryId: "9007199254740993",
        githubWorkflowRunId: String(removed.githubWorkflowRunId),
      }),
    ).resolves.toEqual([])
  })

  it("returns enough candidates to reject ambiguous runs instead of choosing one Build", async () => {
    const repository = await createRepository()
    const builds = [
      await createBuild(repository.id),
      await createBuild(repository.id),
      await createBuild(repository.id),
    ]

    const targets = await findPathPreviewTargets(prisma, {
      githubRepositoryId: "9007199254740993",
      githubWorkflowRunId: "9007199254740995",
    })

    expect(targets).toHaveLength(2)
    expect(new Set(targets.map((target) => target.buildId)).size).toBe(2)
    for (const target of targets) {
      expect(builds.map((build) => build.id)).toContain(target.buildId)
    }
  })

  it("marks default-branch artifacts as templates and excludes workflow installation branches", async () => {
    const repository = await createRepository()
    const template = await createBuild(repository.id, { branchName: "main", runId: 201n })
    await createBuild(repository.id, { branchName: "replica/install-workflow", runId: 202n })

    await expect(
      findPathPreviewTargets(prisma, {
        githubRepositoryId: "9007199254740993",
        githubWorkflowRunId: "201",
      }),
    ).resolves.toEqual([
      { buildId: template.id, repository: { id: repository.id, local: false }, template: true },
    ])
    await expect(
      findPathPreviewTargets(prisma, {
        githubRepositoryId: "9007199254740993",
        githubWorkflowRunId: "202",
      }),
    ).resolves.toEqual([])
  })
})
