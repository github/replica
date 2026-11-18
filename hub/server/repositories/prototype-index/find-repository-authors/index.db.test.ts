import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { findRepositoryAuthors } from "."

describe("findRepositoryAuthors()", () => {
  it("withholds authors when repository access is revoked after their read", async () => {
    const viewer = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: viewer.id } })
    const author = await prisma.user.create({
      data: { profile: { create: { provider: "github", login: "mona", name: "Mona" } } },
    })
    const repository = await prisma.repository.create({
      data: { githubRepositoryId: 1001, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const grant = await prisma.repositoryAccessGrant.create({
      data: { membershipId: membership.id, repositoryId: repository.id, observedAt: new Date() },
    })
    await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        authorId: author.id,
        branchName: "prototype/checkout",
        name: "Checkout",
        registeredAt: new Date("2026-10-01T00:00:00Z"),
      },
    })
    const filters = { viewerId: viewer.id, query: "", after: null }
    const scope = { membershipId: membership.id }
    await expect(findRepositoryAuthors(prisma, repository.id, filters, scope)).resolves.toEqual({
      authors: [
        { id: author.id, provider: "github", login: "mona", name: "Mona", avatarUrl: null },
      ],
      next: null,
    })

    let observedAuthors: unknown[] = []
    const observedDatabase = prisma.$extends({
      query: {
        user: {
          async findMany({ args, query }) {
            const rows = await query(args)
            observedAuthors = rows
            await prisma.repositoryAccessGrant.delete({ where: { id: grant.id } })
            return rows
          },
        },
      },
    })
    const user: typeof prisma.user = new Proxy(prisma.user, {
      get(target, property, receiver) {
        if (property === "findMany") {
          return observedDatabase.user.findMany.bind(observedDatabase.user)
        }
        const value: unknown = Reflect.get(target, property, receiver)
        return value
      },
    })
    const database = { repository: prisma.repository, user }

    await expect(findRepositoryAuthors(database, repository.id, filters, scope)).resolves.toBeNull()
    expect(observedAuthors).toMatchObject([{ id: author.id }])
  })
})
