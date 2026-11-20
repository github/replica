import { describe, expect, it, vi } from "vitest"

import { prisma } from "../../../integrations/prisma/index.ts"
import { repairGitHubBuildAuthor } from "./index.ts"

describe("repairGitHubBuildAuthor()", () => {
  async function fixture() {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "octo/demo", defaultBranch: "main", githubRepositoryId: 56 },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "proto/demo" },
    })
    const build = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        state: "successful",
        commitSha: "a".repeat(40),
        githubWorkflowRunId: 7,
        distDigest: `sha256:${"b".repeat(64)}`,
      },
    })
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { currentBuildId: build.id },
    })
    const getCommitAuthor = vi.fn().mockResolvedValue({
      providerUserId: "9",
      login: "commit-author",
      avatarUrl: null,
    })
    return {
      build,
      prototype,
      getCommitAuthor,
      dependencies: { database: prisma, client: { getCommitAuthor }, logger: { warn: vi.fn() } },
      input: { buildId: build.id, githubRepositoryId: 56, apply: false },
    }
  }

  it("defaults to observing the saved commit, then applies metadata once without changing selection or imported content", async () => {
    const { dependencies, input, build, prototype, getCommitAuthor } = await fixture()
    expect(await repairGitHubBuildAuthor(dependencies, input)).toEqual({ status: "available" })
    expect(getCommitAuthor).toHaveBeenCalledWith(build.commitSha)
    expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(build)

    expect(await repairGitHubBuildAuthor(dependencies, { ...input, apply: true })).toEqual({
      status: "updated",
    })
    const after = await prisma.build.findUniqueOrThrow({ where: { id: build.id } })
    expect(after).toMatchObject({
      state: "successful",
      distDigest: build.distDigest,
      githubWorkflowRunId: build.githubWorkflowRunId,
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: "9",
      authorLogin: "commit-author",
    })
    expect(
      (await prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } })).currentBuildId,
    ).toBe(build.id)
    expect(await repairGitHubBuildAuthor(dependencies, { ...input, apply: true })).toEqual({
      status: "unchanged",
    })
    expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(after)
  })

  it("rejects a repository mismatch before resolving a private commit", async () => {
    const { dependencies, input, getCommitAuthor } = await fixture()
    await expect(
      repairGitHubBuildAuthor(dependencies, { ...input, githubRepositoryId: 99, apply: true }),
    ).rejects.toThrow("No GitHub Build matches")
    expect(getCommitAuthor).not.toHaveBeenCalled()
  })

  it("leaves an unmapped commit unknown and observable, and propagates provider failures", async () => {
    const { dependencies, input, build, getCommitAuthor } = await fixture()
    getCommitAuthor.mockResolvedValueOnce(null)
    expect(await repairGitHubBuildAuthor(dependencies, { ...input, apply: true })).toEqual({
      status: "unavailable",
    })
    expect(dependencies.logger.warn).toHaveBeenCalled()
    getCommitAuthor.mockRejectedValueOnce(new Error("provider unavailable"))
    await expect(repairGitHubBuildAuthor(dependencies, { ...input, apply: true })).rejects.toThrow(
      "provider unavailable",
    )
    expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(build)
  })
})
