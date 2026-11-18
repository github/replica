import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { createQueryCountingClient } from "../../../../test/database/create-query-counting-client/index.ts"
import { replaceRepositoryAccessGrants } from "."

async function createMembership() {
  const user = await prisma.user.create({ data: { id: randomUUID() } })
  return prisma.membership.create({ data: { userId: user.id } })
}

async function createRepositories(count: number) {
  return prisma.repository.createManyAndReturn({
    data: Array.from({ length: count }, (_, index) => ({
      defaultBranch: "main",
      githubRepositoryId: BigInt(index + 1),
      nameWithOwner: `octo/repo-${index + 1}`,
    })),
    select: { id: true },
  })
}

describe("replaceRepositoryAccessGrants", () => {
  it("revokes stale grants, refreshes kept grants and creates only missing ones", async () => {
    const membership = await createMembership()
    const other = await createMembership()
    const [stale, kept, added] = await createRepositories(3)
    const before = new Date("2024-01-01")
    await prisma.repositoryAccessGrant.createMany({
      data: [
        { membershipId: membership.id, observedAt: before, repositoryId: stale!.id },
        { membershipId: membership.id, observedAt: before, repositoryId: kept!.id },
        { membershipId: other.id, observedAt: before, repositoryId: stale!.id },
      ],
    })
    const keptGrant = await prisma.repositoryAccessGrant.findFirstOrThrow({
      where: { membershipId: membership.id, repositoryId: kept!.id },
    })
    const observedAt = new Date("2024-06-01")
    const createdIds: string[] = []

    await replaceRepositoryAccessGrants(prisma, {
      createId: () => {
        const id = randomUUID()
        createdIds.push(id)
        return id
      },
      membershipId: membership.id,
      observedAt,
      repositoryIds: [kept!.id, added!.id, added!.id],
    })

    const grants = await prisma.repositoryAccessGrant.findMany({
      where: { membershipId: membership.id },
    })
    expect(
      grants.map(({ id, observedAt, repositoryId }) => ({ id, observedAt, repositoryId })),
    ).toEqual(
      expect.arrayContaining([
        { id: keptGrant.id, observedAt, repositoryId: kept!.id },
        { id: createdIds[0], observedAt, repositoryId: added!.id },
      ]),
    )
    expect(grants).toHaveLength(2)
    expect(createdIds).toHaveLength(1)
    expect(await prisma.repositoryAccessGrant.count({ where: { membershipId: other.id } })).toBe(1)

    await replaceRepositoryAccessGrants(prisma, {
      createId: randomUUID,
      membershipId: membership.id,
      observedAt,
      repositoryIds: [],
    })
    expect(
      await prisma.repositoryAccessGrant.count({ where: { membershipId: membership.id } }),
    ).toBe(0)
  })

  it("replaces a supported installation's grants in a bounded number of queries", async () => {
    const membership = await createMembership()
    const repositories = await createRepositories(2_000)
    const counted = createQueryCountingClient()

    await replaceRepositoryAccessGrants(counted.client, {
      createId: randomUUID,
      membershipId: membership.id,
      observedAt: new Date(),
      repositoryIds: repositories.map((repository) => repository.id),
    }).finally(() => counted.client.$disconnect())

    expect(counted.statements()).toBeLessThanOrEqual(4)
    expect(
      await prisma.repositoryAccessGrant.count({ where: { membershipId: membership.id } }),
    ).toBe(2_000)
  })
})
