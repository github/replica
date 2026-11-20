import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { recordGitHubBuildAuthor } from "."

async function createBuild() {
  const githubRepositoryId = randomInt(1, 2 ** 31)
  const repository = await prisma.repository.create({
    data: { githubRepositoryId, nameWithOwner: `octo/${randomUUID()}`, defaultBranch: "main" },
  })
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId: repository.id,
      branchName: "proto/welcome",
      name: "Welcome",
      registeredAt: new Date(),
    },
  })
  const build = await prisma.build.create({
    data: {
      prototypeId: prototype.id,
      number: 1,
      state: "successful",
      commitSha: "a".repeat(40),
      githubWorkflowRunId: 9_007_199_254_740_993n,
      githubWorkflowRunAttempt: 2,
      distDigest: "sha256:" + "b".repeat(64),
      startedAt: new Date("2026-01-01T00:00:00Z"),
      finishedAt: new Date("2026-01-01T00:01:00Z"),
      workflowCompletedAt: new Date("2026-01-01T00:01:00Z"),
      artifacts: {
        create: {
          kind: "dist",
          path: "dist/index.html",
          storageKey: randomUUID(),
          byteLength: 10,
        },
      },
    },
  })
  await prisma.prototype.update({
    where: { id: prototype.id },
    data: { currentBuildId: build.id },
  })
  const input = {
    buildId: build.id,
    commitSha: build.commitSha!,
    githubRepositoryId,
    githubWorkflowRunId: build.githubWorkflowRunId,
    author: { providerUserId: "101", login: "commit-author", avatarUrl: null },
  }
  return { input, find: () => findBuild(build.id) }
}

function findBuild(id: string) {
  return prisma.build.findUniqueOrThrow({
    where: { id },
    include: { artifacts: true, prototype: true },
  })
}

describe("recordGitHubBuildAuthor()", () => {
  it("records a legacy Build's author once without changing its import, owner, or selection", async () => {
    const { input, find } = await createBuild()
    const legacy = await find()
    const users = await prisma.user.count()

    await expect(recordGitHubBuildAuthor(prisma, input)).resolves.toEqual({ status: "updated" })

    const repaired = await find()
    expect(repaired).toEqual({
      ...legacy,
      updatedAt: repaired.updatedAt,
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: "101",
      authorLogin: "commit-author",
    })
    await expect(recordGitHubBuildAuthor(prisma, input)).resolves.toEqual({
      status: "unchanged",
    })
    expect(await find()).toEqual(repaired)
    expect(await prisma.user.count()).toBe(users)
  })

  it("does not replace an existing Build author snapshot or prototype owner", async () => {
    const { input, find } = await createBuild()
    const owner = await prisma.user.create({ data: {} })
    const saved = await find()
    await prisma.prototype.update({
      where: { id: saved.prototypeId },
      data: { authorId: owner.id },
    })
    await prisma.build.update({
      where: { id: saved.id },
      data: {
        authorProvider: "github",
        authorIssuer: "https://github.com",
        authorProviderUserId: "101",
        authorLogin: "saved-author",
        authorName: "Saved author name",
      },
    })
    const before = await find()

    await expect(
      recordGitHubBuildAuthor(prisma, {
        ...input,
        author: { providerUserId: "202", login: "different-author", avatarUrl: null },
      }),
    ).resolves.toEqual({ status: "preserved" })

    expect(await find()).toEqual(before)
  })
})
