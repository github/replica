import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma/index.ts"
import { findPrototypeDetail } from "../find-prototype-detail/index.ts"
import { findRepositoryIndex } from "./index.ts"

describe("GitHub author display", () => {
  it("uses the current Build's provider snapshot without inventing a Hub owner, even on a different Build page", async () => {
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
    const detail = await findPrototypeDetail(prisma, repository.id, prototype.id, undefined, {
      page: 1,
      pageSize: 1,
    })

    expect(index?.prototypes[0]).toMatchObject({ authorId: null, authorLogin: "commit-author" })
    expect(index?.authors).toEqual([])
    expect(detail?.prototype).toMatchObject({
      authorLogin: "commit-author",
      authorProvider: "github",
    })
    expect(await prisma.user.count()).toBe(0)

    await prisma.prototype.update({ where: { id: prototype.id }, data: { currentBuildId: null } })
    const olderPage = await findPrototypeDetail(prisma, repository.id, prototype.id, undefined, {
      page: 2,
      pageSize: 1,
    })
    expect(olderPage?.prototype.authorLogin).toBeNull()
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
    expect(
      (await findPrototypeDetail(prisma, repository.id, prototype.id))?.prototype.authorLogin,
    ).toBe("owner")
  })
})
