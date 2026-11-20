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
    const author = {
      providerUserId: "9",
      login: "commit-author",
      avatarUrl: "https://example.test/author.png",
    }
    const getCommitAuthor = vi.fn().mockResolvedValue(author)
    return {
      author,
      build,
      prototype,
      repository,
      getCommitAuthor,
      dependencies: { database: prisma, client: { getCommitAuthor }, logger: { warn: vi.fn() } },
      input: { buildId: build.id, githubRepositoryId: 56, apply: false },
    }
  }

  it("previews and applies only the target Build attribution without assigning a mapped owner", async () => {
    const { author, dependencies, input, build, prototype, getCommitAuthor } = await fixture()
    const mapped = await prisma.user.create({
      data: {
        externalIdentities: {
          create: {
            provider: "github",
            issuer: "https://github.com",
            subject: author.providerUserId,
          },
        },
      },
      include: { profile: true },
    })
    const otherBuild = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 2,
        state: "successful",
        commitSha: "c".repeat(40),
        githubWorkflowRunId: 8,
      },
    })
    const beforePrototype = await prisma.prototype.findUniqueOrThrow({
      where: { id: prototype.id },
    })
    const beforeIdentity = await prisma.externalIdentity.findFirstOrThrow({
      where: { userId: mapped.id },
    })

    expect(mapped.profile).toBeNull()
    expect(beforePrototype.authorId).toBeNull()
    expect(await repairGitHubBuildAuthor(dependencies, input)).toEqual({
      status: "available",
      author,
      build: "would-update",
      prototypeOwner: "unchanged",
    })
    expect(getCommitAuthor).toHaveBeenCalledWith(build.commitSha)
    expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(build)
    expect(await prisma.build.findUnique({ where: { id: otherBuild.id } })).toEqual(otherBuild)
    expect(await prisma.prototype.findUnique({ where: { id: prototype.id } })).toEqual(
      beforePrototype,
    )
    expect(
      await prisma.user.findUnique({ where: { id: mapped.id }, include: { profile: true } }),
    ).toEqual(mapped)
    expect(await prisma.externalIdentity.findUnique({ where: { id: beforeIdentity.id } })).toEqual(
      beforeIdentity,
    )

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
      authorAvatarUrl: author.avatarUrl,
    })
    expect(await prisma.prototype.findUnique({ where: { id: prototype.id } })).toEqual(
      beforePrototype,
    )
    expect(
      await prisma.user.findUnique({ where: { id: mapped.id }, include: { profile: true } }),
    ).toEqual(mapped)
    expect(await prisma.externalIdentity.findUnique({ where: { id: beforeIdentity.id } })).toEqual(
      beforeIdentity,
    )
    expect(await repairGitHubBuildAuthor(dependencies, { ...input, apply: true })).toEqual({
      status: "unchanged",
    })
    const renamedAuthor = { ...author, login: "renamed-author" }
    getCommitAuthor.mockResolvedValueOnce(renamedAuthor)
    expect(await repairGitHubBuildAuthor(dependencies, input)).toEqual({
      status: "available",
      author: renamedAuthor,
      build: "unchanged",
      prototypeOwner: "unchanged",
    })
    expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(after)
    expect(await prisma.build.findUnique({ where: { id: otherBuild.id } })).toEqual(otherBuild)
    expect(await prisma.prototype.findUnique({ where: { id: prototype.id } })).toEqual(
      beforePrototype,
    )
  })

  it.each([
    { field: "legacy login", snapshot: { authorLogin: "legacy-author" } },
    { field: "legacy name", snapshot: { authorName: "Legacy author" } },
    { field: "legacy avatar", snapshot: { authorAvatarUrl: "https://example.test/legacy.png" } },
    {
      field: "different GitHub identity",
      snapshot: {
        authorProvider: "github",
        authorIssuer: "https://github.com",
        authorProviderUserId: "10",
        authorLogin: "other-author",
      },
    },
  ])(
    "previews and preserves a $field author snapshot rather than mixing identities",
    async ({ snapshot }) => {
      const { author, dependencies, input, build, prototype } = await fixture()
      await prisma.build.update({ where: { id: build.id }, data: snapshot })
      await prisma.user.create({
        data: {
          externalIdentities: {
            create: { provider: "github", issuer: "https://github.com", subject: "9" },
          },
        },
      })
      const before = await prisma.build.findUniqueOrThrow({ where: { id: build.id } })
      const beforePrototype = await prisma.prototype.findUniqueOrThrow({
        where: { id: prototype.id },
      })

      expect(await repairGitHubBuildAuthor(dependencies, input)).toEqual({
        status: "available",
        author,
        build: "preserved",
        prototypeOwner: "unchanged",
      })
      expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(before)
      expect(await prisma.prototype.findUnique({ where: { id: prototype.id } })).toEqual(
        beforePrototype,
      )

      await expect(
        repairGitHubBuildAuthor(dependencies, { ...input, apply: true }),
      ).resolves.toEqual({ status: "preserved" })

      expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(before)
      expect(
        (await prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } })).authorId,
      ).toBe(null)
      expect(await prisma.user.count()).toBe(1)
    },
  )

  it("keeps an explicit prototype owner while applying a different commit author", async () => {
    const { author, dependencies, input, build, prototype } = await fixture()
    const owner = await prisma.user.create({ data: {} })
    await prisma.user.create({
      data: {
        externalIdentities: {
          create: { provider: "github", issuer: "https://github.com", subject: "9" },
        },
      },
    })
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { authorId: owner.id },
    })

    expect(await repairGitHubBuildAuthor(dependencies, input)).toEqual({
      status: "available",
      author,
      build: "would-update",
      prototypeOwner: "unchanged",
    })
    expect(
      (await prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } })).authorId,
    ).toBe(owner.id)
    expect(await repairGitHubBuildAuthor(dependencies, { ...input, apply: true })).toEqual({
      status: "updated",
    })
    expect(await prisma.build.findUniqueOrThrow({ where: { id: build.id } })).toMatchObject({
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: "9",
      authorLogin: "commit-author",
    })
    expect(
      (await prisma.prototype.findUniqueOrThrow({ where: { id: prototype.id } })).authorId,
    ).toBe(owner.id)
  })

  it("rejects repair if the repository is disconnected during the author lookup", async () => {
    const { dependencies, input, build, prototype, repository, getCommitAuthor } = await fixture()
    await prisma.user.create({
      data: {
        externalIdentities: {
          create: { provider: "github", issuer: "https://github.com", subject: "9" },
        },
      },
    })
    const beforePrototype = await prisma.prototype.findUniqueOrThrow({
      where: { id: prototype.id },
    })
    getCommitAuthor.mockImplementationOnce(async () => {
      await prisma.repository.update({
        where: { id: repository.id },
        data: { removedAt: new Date("2026-01-02T00:00:00Z") },
      })
      return { providerUserId: "9", login: "commit-author", avatarUrl: null }
    })

    await expect(repairGitHubBuildAuthor(dependencies, { ...input, apply: true })).rejects.toThrow(
      "The GitHub repository is no longer connected.",
    )

    expect(getCommitAuthor).toHaveBeenCalledWith(build.commitSha)
    expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(build)
    expect(await prisma.prototype.findUnique({ where: { id: prototype.id } })).toEqual(
      beforePrototype,
    )
  })

  it("rejects repair if the Build commit changes during the author lookup", async () => {
    const { dependencies, input, build, prototype, getCommitAuthor } = await fixture()
    await prisma.user.create({
      data: {
        externalIdentities: {
          create: { provider: "github", issuer: "https://github.com", subject: "9" },
        },
      },
    })
    const beforePrototype = await prisma.prototype.findUniqueOrThrow({
      where: { id: prototype.id },
    })
    let changedBuild: typeof build | undefined
    getCommitAuthor.mockImplementationOnce(async () => {
      changedBuild = await prisma.build.update({
        where: { id: build.id },
        data: { commitSha: "b".repeat(40) },
      })
      return { providerUserId: "9", login: "commit-author", avatarUrl: null }
    })

    await expect(repairGitHubBuildAuthor(dependencies, { ...input, apply: true })).rejects.toThrow(
      "The Build no longer matches the repository, commit, and run.",
    )

    expect(getCommitAuthor).toHaveBeenCalledWith(build.commitSha)
    expect(changedBuild).toBeDefined()
    expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(changedBuild)
    expect(await prisma.prototype.findUnique({ where: { id: prototype.id } })).toEqual(
      beforePrototype,
    )
  })

  it("rejects repair if the Build run changes during the author lookup", async () => {
    const { dependencies, input, build, prototype, getCommitAuthor } = await fixture()
    const beforePrototype = await prisma.prototype.findUniqueOrThrow({
      where: { id: prototype.id },
    })
    let changedBuild: typeof build | undefined
    getCommitAuthor.mockImplementationOnce(async () => {
      changedBuild = await prisma.build.update({
        where: { id: build.id },
        data: { githubWorkflowRunId: 8 },
      })
      return { providerUserId: "9", login: "commit-author", avatarUrl: null }
    })

    await expect(repairGitHubBuildAuthor(dependencies, { ...input, apply: true })).rejects.toThrow(
      "The Build no longer matches the repository, commit, and run.",
    )

    expect(changedBuild).toBeDefined()
    expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(changedBuild)
    expect(await prisma.prototype.findUnique({ where: { id: prototype.id } })).toEqual(
      beforePrototype,
    )
  })

  it.each([false, true])(
    "rejects a repository mismatch before resolving a private commit with apply=%s",
    async (apply) => {
      const { dependencies, input, getCommitAuthor } = await fixture()
      await expect(
        repairGitHubBuildAuthor(dependencies, { ...input, githubRepositoryId: 99, apply }),
      ).rejects.toThrow("No GitHub Build matches")
      expect(getCommitAuthor).not.toHaveBeenCalled()
    },
  )

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
