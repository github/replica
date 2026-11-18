import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { createLearningRun } from "."

describe("createLearningRun()", () => {
  it("reuses one active run after concurrent requests without aborting the transaction", async () => {
    const repositoryId = randomUUID()
    const userId = randomUUID()
    const membershipId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.user.create({ data: { id: userId } })
    await prisma.membership.create({ data: { id: membershipId, userId } })
    const input = {
      repositoryId,
      requestedById: userId,
      requestedByMembershipId: membershipId,
      snapshotDigest: `sha256:${"a".repeat(64)}`,
    }

    const results = await Promise.all([
      prisma.$transaction((transaction) => createLearningRun(transaction, input)),
      prisma.$transaction((transaction) => createLearningRun(transaction, input)),
    ])

    expect(new Set(results.map(({ run }) => run.id)).size).toBe(1)
    expect(results.filter(({ created }) => created)).toHaveLength(1)
    expect(await prisma.learningRun.count()).toBe(1)
  })

  it("keeps one active run when scheduled discovery races a user request", async () => {
    const repositoryId = randomUUID()
    const userId = randomUUID()
    const membershipId = randomUUID()
    await prisma.repository.create({
      data: { id: repositoryId, nameWithOwner: "team/race", defaultBranch: "main" },
    })
    await prisma.user.create({ data: { id: userId } })
    await prisma.membership.create({ data: { id: membershipId, userId } })

    const [scheduled, requested] = await Promise.all([
      prisma.$transaction((transaction) =>
        createLearningRun(transaction, {
          repositoryId,
          scheduled: true,
          snapshotDigest: `sha256:${"a".repeat(64)}`,
        }),
      ),
      prisma.$transaction((transaction) =>
        createLearningRun(transaction, {
          repositoryId,
          requestedById: userId,
          requestedByMembershipId: membershipId,
          snapshotDigest: `sha256:${"b".repeat(64)}`,
        }),
      ),
    ])

    expect(new Set([scheduled.run.id, requested.run.id]).size).toBe(1)
    expect([scheduled, requested].filter(({ created }) => created)).toHaveLength(1)
    expect(await prisma.learningRun.count()).toBe(1)
    await expect(
      prisma.learningRun.findFirstOrThrow({ where: { repositoryId } }),
    ).resolves.toMatchObject({
      scheduled: false,
      requestedById: userId,
      requestedByMembershipId: membershipId,
      snapshotDigest: `sha256:${"b".repeat(64)}`,
    })
  })
})
