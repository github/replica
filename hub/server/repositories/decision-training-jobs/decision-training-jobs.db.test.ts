import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createDecisionModelStore } from "../../domains/decision-model/create-decision-model-store/index.ts"
import { prisma } from "../../integrations/prisma/index.ts"
import { createOrGetDecisionTrainingJob } from "./create-or-get-decision-training-job/index.ts"

describe("decision training job repositories", () => {
  async function configuredRepository() {
    const user = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    await prisma.decisionModelConfiguration.create({
      data: {
        repositoryId: repository.id,
        enabled: true,
        backend: "fixture",
        maxUpdates: 8,
        maxSeconds: 300,
        monthlyBudgetCredits: "10",
      },
    })
    return { membership, repository }
  }

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

  it("atomically reserves the monthly budget and records one request audit", async () => {
    const { membership, repository } = await configuredRepository()
    const store = createDecisionModelStore(prisma)
    const taskset = {
      bytes: new Uint8Array(),
      consentGrantId: "grant_training",
      exportDigest: `sha256:${"a".repeat(64)}`,
      repeatableReviewSnapshotDigest: `sha256:${"e".repeat(64)}`,
      questionDigest: `sha256:${"b".repeat(64)}`,
      buildSetDigest: `sha256:${"c".repeat(64)}`,
      tasksetDigest: `sha256:${"d".repeat(64)}`,
    }
    const settings = {
      enabled: true,
      backend: "fixture",
      maxUpdates: 8,
      maxSeconds: 300,
      monthlyBudgetCredits: "10",
    }

    const results = await Promise.allSettled(
      ["request-one", "request-two"].map((idempotencyKey) =>
        store.createOrGetJob({
          repositoryId: repository.id,
          requestedByMembershipId: membership.id,
          idempotencyKey,
          configurationGeneration: 1,
          settings,
          taskset,
        }),
      ),
    )

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1)
    expect(await prisma.decisionTrainingJob.count()).toBe(1)
    expect(
      await prisma.securityAudit.count({ where: { action: "decision.training.requested" } }),
    ).toBe(1)
  })

  it("does not replace or re-audit a terminal state", async () => {
    const { membership, repository } = await configuredRepository()
    const store = createDecisionModelStore(prisma)
    const created = await store.createOrGetJob({
      repositoryId: repository.id,
      requestedByMembershipId: membership.id,
      idempotencyKey: "terminal-state",
      configurationGeneration: 1,
      settings: {
        enabled: true,
        backend: "fixture",
        maxUpdates: 8,
        maxSeconds: 300,
        monthlyBudgetCredits: "10",
      },
      taskset: {
        bytes: new Uint8Array(),
        consentGrantId: "grant_training",
        exportDigest: `sha256:${"a".repeat(64)}`,
        repeatableReviewSnapshotDigest: `sha256:${"e".repeat(64)}`,
        questionDigest: `sha256:${"b".repeat(64)}`,
        buildSetDigest: `sha256:${"c".repeat(64)}`,
        tasksetDigest: `sha256:${"d".repeat(64)}`,
      },
    })
    await store.updateJobState({
      jobId: created.job.id,
      state: "FAILED",
      audit: {
        actorMembershipId: membership.id,
        outcome: "failed",
        reason: "runtime_failed",
        repositoryId: repository.id,
      },
    })

    const retained = await store.updateJobState({
      jobId: created.job.id,
      state: "CANCELLED",
      audit: {
        actorMembershipId: membership.id,
        outcome: "cancelled",
        repositoryId: repository.id,
      },
    })

    expect(retained.state).toBe("FAILED")
    expect(
      await prisma.securityAudit.count({ where: { action: "decision.training.cancelled" } }),
    ).toBe(0)
  })
})
