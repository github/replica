import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { findPrototypeDetail } from "."

describe("findPrototypeDetail()", () => {
  it("withholds a visible snapshot after its repository grant is revoked while another grant remains", async () => {
    const membership = await prisma.membership.create({
      data: { user: { create: {} } },
    })
    const repositoryId = randomUUID()
    const retainedRepositoryId = randomUUID()
    await prisma.repository.createMany({
      data: [
        { id: repositoryId, nameWithOwner: "team/private", defaultBranch: "main" },
        { id: retainedRepositoryId, nameWithOwner: "team/retained", defaultBranch: "main" },
      ],
    })
    await prisma.repositoryAccessGrant.createMany({
      data: [repositoryId, retainedRepositoryId].map((id) => ({
        membershipId: membership.id,
        repositoryId: id,
        observedAt: new Date(),
      })),
    })
    const prototype = await prisma.prototype.create({
      data: {
        repositoryId,
        branchName: "prototype/private",
        name: "Private prototype",
        builds: { create: { number: 1, state: "successful" } },
      },
    })
    const retainedPrototype = await prisma.prototype.create({
      data: {
        repositoryId: retainedRepositoryId,
        branchName: "prototype/retained",
        name: "Retained prototype",
      },
    })
    const scope = { membershipId: membership.id }
    const visibleDetail = {
      repository: { id: repositoryId },
      prototype: { id: prototype.id },
      selectedBuild: { number: 1, state: "successful" },
    }
    await expect(
      findPrototypeDetail(prisma, repositoryId, prototype.id, undefined, scope),
    ).resolves.toMatchObject(visibleDetail)

    const transaction = prisma.$transaction.bind(prisma)
    vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (operation, options) => {
      const snapshot = await transaction(operation, options)
      await prisma.repositoryAccessGrant.deleteMany({
        where: { membershipId: membership.id, repositoryId },
      })
      return snapshot
    })

    const revokedDetail = await findPrototypeDetail(
      prisma,
      repositoryId,
      prototype.id,
      undefined,
      scope,
    )
    await expect(
      findPrototypeDetail(prisma, retainedRepositoryId, retainedPrototype.id, undefined, scope),
    ).resolves.toMatchObject({ repository: { id: retainedRepositoryId } })
    await expect(findPrototypeDetail(prisma, repositoryId, prototype.id)).resolves.toMatchObject(
      visibleDetail,
    )
    expect(revokedDetail).toBeNull()
  })
})
