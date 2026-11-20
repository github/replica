import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { findRepositoryIndex } from "."

describe("findRepositoryIndex()", () => {
  it("uses the current Build's provider snapshot without inventing a Hub owner", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "octo/demo", defaultBranch: "main" },
    })
    const prototype = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "proto/demo",
        name: "Demo",
        registeredAt: new Date(),
      },
    })
    const current = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        authorProvider: "github",
        authorIssuer: "https://github.com",
        authorProviderUserId: "9",
        authorLogin: "commit-author",
      },
    })
    await prisma.build.create({
      data: { prototypeId: prototype.id, number: 2 },
    })
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { currentBuildId: current.id },
    })

    const index = await findRepositoryIndex(prisma, repository.id)
    expect(index?.prototypes[0]).toMatchObject({ authorId: null, authorLogin: "commit-author" })
    expect(index?.authors).toEqual([])
    expect(await prisma.user.count()).toBe(0)
  })

  it("keeps the explicit Hub owner rather than substituting a contributor", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "octo/demo", defaultBranch: "main" },
    })
    const owner = await prisma.user.create({
      data: { profile: { create: { provider: "github", login: "owner" } } },
    })
    const prototype = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "proto/demo",
        name: "Demo",
        registeredAt: new Date(),
        authorId: owner.id,
      },
    })
    await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        authorProvider: "github",
        authorIssuer: "https://github.com",
        authorProviderUserId: "9",
        authorLogin: "contributor",
      },
    })
    expect((await findRepositoryIndex(prisma, repository.id))?.prototypes[0]).toMatchObject({
      authorId: owner.id,
      authorLogin: "owner",
    })
  })

  it("searches only the displayed Build author within the requested repository", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "octo/demo", defaultBranch: "main" },
    })
    const otherRepository = await prisma.repository.create({
      data: { nameWithOwner: "octo/other", defaultBranch: "main" },
    })
    const owner = await prisma.user.create({
      data: { profile: { create: { provider: "github", login: "explicit-owner" } } },
    })
    function createPrototype(branch: string) {
      return prisma.prototype.create({
        data: {
          repositoryId: branch === "other" ? otherRepository.id : repository.id,
          branchName: `proto/${branch}`,
          name: branch,
          registeredAt: new Date(),
          ...(branch === "owned" ? { authorId: owner.id } : {}),
        },
      })
    }
    const [current, latest, owned, other] = await Promise.all([
      createPrototype("current"),
      createPrototype("latest"),
      createPrototype("owned"),
      createPrototype("other"),
    ])
    const authorIdentity = {
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: "9",
    }
    const currentBuild = await prisma.build.create({
      data: {
        prototypeId: current.id,
        number: 1,
        ...authorIdentity,
        authorLogin: "displayed-current",
        createdAt: new Date("2026-01-01"),
      },
    })
    await prisma.prototype.update({
      where: { id: current.id },
      data: { currentBuildId: currentBuild.id },
    })
    await prisma.build.createMany({
      data: [
        {
          prototypeId: current.id,
          number: 2,
          ...authorIdentity,
          authorLogin: "hidden-newer",
          createdAt: new Date("2026-01-02"),
        },
        {
          prototypeId: latest.id,
          number: 1,
          ...authorIdentity,
          authorLogin: "displayed-latest",
          createdAt: new Date("2026-01-01"),
          workflowCreatedAt: new Date("2026-01-03"),
        },
        {
          prototypeId: latest.id,
          number: 2,
          ...authorIdentity,
          authorLogin: "hidden-older",
          createdAt: new Date("2026-01-02"),
        },
        {
          prototypeId: owned.id,
          number: 1,
          ...authorIdentity,
          authorLogin: "hidden-contributor",
        },
        {
          prototypeId: other.id,
          number: 1,
          ...authorIdentity,
          authorLogin: "displayed-current",
        },
      ],
    })
    async function search(query: string) {
      return findRepositoryIndex(prisma, repository.id, { query, authorId: null, page: 1 })
    }

    expect((await search("displayed-current"))?.prototypes.map(({ id }) => id)).toEqual([
      current.id,
    ])
    expect((await search("DISPLAYED-LATEST"))?.prototypes.map(({ id }) => id)).toEqual([latest.id])
    expect((await search("hidden"))?.pagination.totalCount).toBe(0)
    expect((await search("explicit-owner"))?.prototypes.map(({ id }) => id)).toEqual([owned.id])
    expect((await search("%"))?.pagination.totalCount).toBe(0)
    expect((await search("_"))?.pagination.totalCount).toBe(0)
  })

  it("counts and pages fallback-author matches before selecting cards", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "octo/demo", defaultBranch: "main" },
    })
    for (let index = 0; index < 25; index++) {
      await prisma.prototype.create({
        data: {
          repositoryId: repository.id,
          branchName: `proto/demo-${index}`,
          name: `Demo ${index}`,
          registeredAt: new Date(Date.UTC(2026, 0, 1, index)),
          builds: {
            create: {
              number: 1,
              authorProvider: "github",
              authorIssuer: "https://github.com",
              authorProviderUserId: "9",
              authorLogin: "matching",
            },
          },
        },
      })
    }

    const page = await findRepositoryIndex(prisma, repository.id, {
      query: "matching",
      authorId: null,
      page: 2,
    })
    expect(page?.pagination).toMatchObject({ page: 2, totalCount: 25, pageCount: 2 })
    expect(page?.prototypes.map(({ branchName }) => branchName)).toEqual(["proto/demo-0"])
  })
})
