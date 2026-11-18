import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma/index.ts"
import { createOrGetDecisionTrainingJob } from "./create-or-get-decision-training-job/index.ts"

describe("decision training job repositories", () => {
  it("converges concurrent requests with the same idempotency key", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const input = {
      repositoryId: repository.id,
      requestedByMembershipId: null,
      idempotencyKey: randomUUID(),
      configurationGeneration: 1,
      backend: "fixture",
      maxUpdates: 8,
      maxSeconds: 300,
      budgetCredits: "10",
      consentGrantId: "grant_training",
      exportDigest: `sha256:${"a".repeat(64)}`,
      repeatableReviewSnapshotDigest: `sha256:${"e".repeat(64)}`,
      questionDigest: `sha256:${"b".repeat(64)}`,
      buildSetDigest: `sha256:${"c".repeat(64)}`,
      tasksetDigest: `sha256:${"d".repeat(64)}`,
    }

    const results = await Promise.all([
      createOrGetDecisionTrainingJob(prisma, input),
      createOrGetDecisionTrainingJob(prisma, input),
    ])

    expect(new Set(results.map(({ job }) => job.id))).toHaveLength(1)
    expect(results.filter(({ created }) => created)).toHaveLength(1)
  })

  it("enforces training bounds for direct database writers", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })

    await expect(
      prisma.decisionModelConfiguration.create({
        data: {
          repositoryId: repository.id,
          enabled: true,
          backend: "fixture",
          maxUpdates: 0,
          maxSeconds: 300,
          monthlyBudgetCredits: "10",
        },
      }),
    ).rejects.toThrow()
  })
})
