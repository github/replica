import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { activateGitHubRepositoryScoping } from "../../../../domains/identity/activate-github-repository-scoping"
import { prisma } from "../../../../integrations/prisma"
import {
  type RepositoryScope,
  visibleRepositoryWhere,
} from "../../../../repositories/prototype-index/visible-repository-where"
import { readWithPersistedRepositoryScope } from "."

const viewer = {
  membershipId: randomUUID(),
  role: "ADMINISTRATOR" as const,
  sessionProvider: "entra",
}

describe("readWithPersistedRepositoryScope", () => {
  it("repeats an unscoped read if another process activates scoping during it", async () => {
    const legacy = await prisma.repository.create({
      data: { nameWithOwner: "team/legacy", defaultBranch: "main" },
    })
    const current = await prisma.repository.create({
      data: { githubRepositoryId: 1001, nameWithOwner: "team/current", defaultBranch: "main" },
    })
    await prisma.prototype.create({
      data: { repositoryId: legacy.id, branchName: "prototype/legacy", name: "Legacy history" },
    })
    const legacyBefore = await prisma.repository.findUniqueOrThrow({
      where: { id: legacy.id },
      include: { prototypes: true },
    })
    let firstRead: string[] = []
    const read = vi.fn(async (scope: RepositoryScope) => {
      const repositories = await prisma.repository.findMany({
        where: visibleRepositoryWhere(scope),
        select: { id: true },
        orderBy: { nameWithOwner: "asc" },
      })
      if (scope === null) {
        firstRead = repositories.map(({ id }) => id)
        await prisma.$transaction(activateGitHubRepositoryScoping)
      }
      return repositories.map(({ id }) => id)
    })

    await expect(readWithPersistedRepositoryScope(prisma, viewer, false, read)).resolves.toEqual([
      current.id,
    ])
    expect(firstRead).toEqual([current.id, legacy.id])
    expect(read.mock.calls.map(([scope]) => scope)).toEqual([null, {}])
    await expect(
      prisma.repository.findUniqueOrThrow({
        where: { id: legacy.id },
        include: { prototypes: true },
      }),
    ).resolves.toEqual(legacyBefore)
  })

  it("returns the unscoped result without repeating it while scoping remains inactive", async () => {
    const legacy = await prisma.repository.create({
      data: { nameWithOwner: "team/legacy", defaultBranch: "main" },
    })
    const read = vi.fn(async (scope: RepositoryScope) =>
      prisma.repository.findMany({
        where: visibleRepositoryWhere(scope),
        select: { id: true },
      }),
    )

    await expect(readWithPersistedRepositoryScope(prisma, viewer, false, read)).resolves.toEqual([
      { id: legacy.id },
    ])
    expect(read).toHaveBeenCalledOnce()
    expect(read).toHaveBeenCalledWith(null)
  })
})
