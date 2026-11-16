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
})
