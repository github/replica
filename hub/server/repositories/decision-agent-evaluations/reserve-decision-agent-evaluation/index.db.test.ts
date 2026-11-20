import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { completeDecisionAgentEvaluation } from "../complete-decision-agent-evaluation"
import { failDecisionAgentEvaluation } from "../fail-decision-agent-evaluation"
import { reserveDecisionAgentEvaluation } from "."

const digest = `sha256:${"a".repeat(64)}`

async function createEvaluationFixture(name: string) {
  const repository = await prisma.repository.create({
    data: { nameWithOwner: `team/${name}`, defaultBranch: "main" },
  })
  await prisma.decisionModelConfiguration.create({
    data: {
      repositoryId: repository.id,
      enabled: true,
      backend: "customer-runtime",
      maxUpdates: 8,
      maxSeconds: 300,
      monthlyBudgetCredits: 100,
    },
  })
  const trainingJob = await prisma.decisionTrainingJob.create({
    data: {
      repositoryId: repository.id,
      idempotencyKey: `${name}-training`,
      configurationGeneration: 1,
      state: "SUCCEEDED",
      backend: "customer-runtime",
      maxUpdates: 8,
      maxSeconds: 300,
      budgetCredits: "10",
      consentGrantId: "grant-training",
      trainingExportId: "export-training",
      evidenceDigest: digest,
      exportDigest: digest,
      repeatableReviewSnapshotDigest: digest,
      questionDigest: digest,
      buildSetDigest: digest,
      tasksetDigest: digest,
    },
  })
  const candidate = await prisma.decisionCandidate.create({
    data: {
      repositoryId: repository.id,
      trainingJobId: trainingJob.id,
      runtimeCandidateId: `${name}-candidate`,
      tasksetDigest: digest,
      manifestDigest: digest,
      evaluationDigest: digest,
      productionEligible: true,
    },
  })
  return { repository, candidate }
}

function reservation(
  repositoryId: string,
  candidateId: string,
  cacheKey: string,
  overrides: Partial<Parameters<typeof reserveDecisionAgentEvaluation>[1]> = {},
) {
  return {
    repositoryId,
    candidateId,
    cacheKey,
    promotionGeneration: 3,
    questionDigest: digest,
    screenshotSetDigest: digest,
    requestUnits: 4,
    ttlMs: 60_000,
    ...overrides,
  }
}

describe("reserveDecisionAgentEvaluation()", () => {
  it("reuses one durable completed evaluation for an identical cache key", async () => {
    const { repository, candidate } = await createEvaluationFixture("completed-cache")
    const input = reservation(repository.id, candidate.id, "1".repeat(64))
    const first = await reserveDecisionAgentEvaluation(prisma, input)
    if (first.status !== "reserved") throw new Error("Expected a fresh reservation.")
    const result = { evaluationId: first.id, findings: [] }
    await completeDecisionAgentEvaluation(prisma, { id: first.id, result })

    await expect(reserveDecisionAgentEvaluation(prisma, input)).resolves.toEqual({
      status: "cached",
      id: first.id,
      result,
    })
    await expect(
      prisma.decisionAgentEvaluation.count({ where: { cacheKey: input.cacheKey } }),
    ).resolves.toBe(1)
  })

  it("fails closed while an identical durable reservation is pending", async () => {
    const { repository, candidate } = await createEvaluationFixture("pending-cache")
    const input = reservation(repository.id, candidate.id, "2".repeat(64))
    await reserveDecisionAgentEvaluation(prisma, input)

    await expect(reserveDecisionAgentEvaluation(prisma, input)).resolves.toEqual({
      status: "busy",
    })
    await expect(
      prisma.decisionAgentEvaluation.count({ where: { cacheKey: input.cacheKey } }),
    ).resolves.toBe(1)
  })

  it("keeps expired consumed units while creating a new reservation", async () => {
    const { repository, candidate } = await createEvaluationFixture("expired-cache")
    const cacheKey = "3".repeat(64)
    const expired = await reserveDecisionAgentEvaluation(
      prisma,
      reservation(repository.id, candidate.id, cacheKey, { ttlMs: -1_000 }),
    )
    if (expired.status !== "reserved") throw new Error("Expected an expired reservation.")
    await completeDecisionAgentEvaluation(prisma, {
      id: expired.id,
      result: { evaluationId: expired.id, findings: ["stale"] },
    })

    const replacement = await reserveDecisionAgentEvaluation(
      prisma,
      reservation(repository.id, candidate.id, cacheKey),
    )

    expect(replacement).toMatchObject({ status: "reserved" })
    expect(replacement.id).not.toBe(expired.id)
    await expect(
      prisma.decisionAgentEvaluation.findUnique({ where: { id: expired.id } }),
    ).resolves.toMatchObject({ state: "COMPLETED", requestUnits: 4, result: null })
  })

  it("keeps request units after dispatched work fails", async () => {
    const { repository, candidate } = await createEvaluationFixture("failed-charge")
    const first = await reserveDecisionAgentEvaluation(
      prisma,
      reservation(repository.id, candidate.id, "6".repeat(64)),
    )
    if (first.status !== "reserved") throw new Error("Expected a fresh reservation.")
    await failDecisionAgentEvaluation(prisma, first.id)

    await expect(
      prisma.decisionAgentEvaluation.findUnique({ where: { id: first.id } }),
    ).resolves.toMatchObject({ state: "FAILED", requestUnits: 4 })
  })

  it("serializes concurrent request-unit reservations under the repository lock", async () => {
    const { repository, candidate } = await createEvaluationFixture("locked-budget")
    await prisma.decisionAgentEvaluation.createMany({
      data: Array.from({ length: 124 }, (_, index) => ({
        repositoryId: repository.id,
        candidateId: candidate.id,
        cacheKey: index.toString(16).padStart(64, "0"),
        promotionGeneration: 3n,
        questionDigest: digest,
        screenshotSetDigest: digest,
        requestUnits: 4,
        state: "FAILED",
        expiresAt: new Date(0),
      })),
    })
    const results = await Promise.allSettled([
      reserveDecisionAgentEvaluation(
        prisma,
        reservation(repository.id, candidate.id, "4".repeat(64), {
          requestUnits: 4,
        }),
      ),
      reserveDecisionAgentEvaluation(
        prisma,
        reservation(repository.id, candidate.id, "5".repeat(64), {
          requestUnits: 4,
        }),
      ),
    ])

    expect(results).toHaveLength(2)
    expect(
      results.filter(
        (result) => result.status === "fulfilled" && result.value.status === "reserved",
      ),
    ).toHaveLength(1)
    expect(
      results.filter(
        (result) => result.status === "fulfilled" && result.value.status === "budget-exhausted",
      ),
    ).toHaveLength(1)
    const saved = await prisma.decisionAgentEvaluation.findMany({
      where: { repositoryId: repository.id, state: "PENDING" },
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.requestUnits).toBe(4)
  })
})
