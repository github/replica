import { describe, expect, it } from "vitest"

import { createDecisionModelStore } from "../../domains/decision-model/create-decision-model-store/index.ts"
import { prisma } from "../../integrations/prisma/index.ts"

describe("decision candidate repositories", () => {
  it("persists candidate evidence, usage, cost, and administrator rejection", async () => {
    const user = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/decision-candidates", defaultBranch: "main" },
    })
    const trainingJob = await prisma.decisionTrainingJob.create({
      data: {
        repositoryId: repository.id,
        requestedByMembershipId: membership.id,
        idempotencyKey: "candidate-evidence",
        configurationGeneration: 1,
        state: "RUNNING",
        backend: "fixture",
        maxUpdates: 8,
        maxSeconds: 300,
        budgetCredits: "10",
        consentGrantId: "grant_training",
        exportDigest: `sha256:${"a".repeat(64)}`,
        repeatableReviewSnapshotDigest: `sha256:${"b".repeat(64)}`,
        questionDigest: `sha256:${"c".repeat(64)}`,
        buildSetDigest: `sha256:${"d".repeat(64)}`,
        tasksetDigest: `sha256:${"e".repeat(64)}`,
      },
    })
    const store = createDecisionModelStore(prisma)

    const completed = await store.completeJobWithCandidate({
      repositoryId: repository.id,
      trainingJobId: trainingJob.id,
      runtimeCandidateId: "runtime-candidate-1",
      tasksetDigest: `sha256:${"e".repeat(64)}`,
      manifestDigest: `sha256:${"f".repeat(64)}`,
      evaluationDigest: `sha256:${"1".repeat(64)}`,
      productionEligible: true,
      baselineMeanReward: 0.55,
      candidateMeanReward: 0.7,
      meanRewardDelta: 0.15,
      baselineCalibrationError: 0.2,
      candidateCalibrationError: 0.12,
      calibrationErrorDelta: -0.08,
      learningMetrics: [
        {
          learningId: "learning-gain",
          baselineBalancedAccuracy: 0.5,
          candidateBalancedAccuracy: 0.75,
          delta: 0.25,
          direction: "gain",
        },
        {
          learningId: "learning-regression",
          baselineBalancedAccuracy: 0.8,
          candidateBalancedAccuracy: 0.6,
          delta: -0.2,
          direction: "regression",
        },
      ],
      durationSeconds: 125,
      usage: [
        {
          connector: "customer-gpu",
          kind: "training_credits",
          quantity: 123.45,
          unit: "credits",
          cost: 8.9,
          currency: "USD",
          source: "customer-runtime",
          metadata: {},
        },
      ],
      actorMembershipId: membership.id,
    })
    if (!completed.candidate) throw new Error("Expected a persisted candidate.")

    await store.rejectCandidate({
      repositoryId: repository.id,
      candidateId: completed.candidate.id,
      rejectedByMembershipId: membership.id,
      reason: "Held-out reward regressed.",
    })

    const candidate = await prisma.decisionCandidate.findUniqueOrThrow({
      where: { id: completed.candidate.id },
    })
    expect(candidate).toMatchObject({
      learningMetrics: [
        {
          learningId: "learning-gain",
          baselineBalancedAccuracy: 0.5,
          candidateBalancedAccuracy: 0.75,
          delta: 0.25,
          direction: "gain",
        },
        {
          learningId: "learning-regression",
          baselineBalancedAccuracy: 0.8,
          candidateBalancedAccuracy: 0.6,
          delta: -0.2,
          direction: "regression",
        },
      ],
      rejectedByMembershipId: membership.id,
      rejectedReason: "Held-out reward regressed.",
    })
    expect(candidate.baselineMeanReward?.toString()).toBe("0.55")
    expect(candidate.candidateMeanReward?.toString()).toBe("0.7")
    expect(candidate.meanRewardDelta?.toString()).toBe("0.15")
    expect(candidate.baselineCalibrationError?.toString()).toBe("0.2")
    expect(candidate.candidateCalibrationError?.toString()).toBe("0.12")
    expect(candidate.calibrationErrorDelta?.toString()).toBe("-0.08")
    expect(candidate.durationSeconds?.toString()).toBe("125")
    expect(candidate.usageRecords).toEqual([
      {
        connector: "customer-gpu",
        kind: "training_credits",
        quantity: 123.45,
        unit: "credits",
        cost: 8.9,
        currency: "USD",
        source: "customer-runtime",
        metadata: {},
      },
    ])
    expect(candidate.rejectedAt).toBeInstanceOf(Date)
    const audit = await prisma.securityAudit.findFirstOrThrow({
      where: { action: "decision.candidate.rejected" },
    })
    expect(audit.context).toMatchObject({ actorMembershipId: membership.id })
  })

  it("allows rejection of a previous promotion but not the current candidate", async () => {
    const user = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/promotion-history", defaultBranch: "main" },
    })
    const jobs = await Promise.all(
      ["first", "second"].map((suffix) =>
        prisma.decisionTrainingJob.create({
          data: {
            repositoryId: repository.id,
            requestedByMembershipId: membership.id,
            idempotencyKey: `candidate-${suffix}`,
            configurationGeneration: 1,
            state: "SUCCEEDED",
            backend: "fixture",
            maxUpdates: 8,
            maxSeconds: 300,
            budgetCredits: "10",
            consentGrantId: "grant_training",
            exportDigest: `sha256:${"a".repeat(64)}`,
            repeatableReviewSnapshotDigest: `sha256:${"b".repeat(64)}`,
            questionDigest: `sha256:${"c".repeat(64)}`,
            buildSetDigest: `sha256:${"d".repeat(64)}`,
            tasksetDigest: `sha256:${"e".repeat(64)}`,
          },
        }),
      ),
    )
    const candidates = await Promise.all(
      jobs.map((job, index) =>
        prisma.decisionCandidate.create({
          data: {
            repositoryId: repository.id,
            trainingJobId: job.id,
            runtimeCandidateId: `runtime-candidate-${index + 1}`,
            tasksetDigest: `sha256:${"e".repeat(64)}`,
            manifestDigest: `sha256:${String(index + 1).repeat(64)}`,
            evaluationDigest: `sha256:${String(index + 3).repeat(64)}`,
            productionEligible: true,
          },
        }),
      ),
    )
    await prisma.decisionModelPromotion.createMany({
      data: [
        {
          repositoryId: repository.id,
          candidateId: candidates[0]!.id,
          promotedByMembershipId: membership.id,
          runtimeGeneration: 1,
          operation: "PROMOTE",
        },
        {
          repositoryId: repository.id,
          candidateId: candidates[1]!.id,
          previousCandidateId: candidates[0]!.id,
          promotedByMembershipId: membership.id,
          runtimeGeneration: 2,
          operation: "PROMOTE",
        },
      ],
    })
    const store = createDecisionModelStore(prisma)

    const rejected = await store.rejectCandidate({
      repositoryId: repository.id,
      candidateId: candidates[0]!.id,
      rejectedByMembershipId: membership.id,
      reason: "Do not restore this candidate.",
    })
    expect(rejected.rejectedAt).toBeInstanceOf(Date)
    await expect(
      store.rejectCandidate({
        repositoryId: repository.id,
        candidateId: candidates[1]!.id,
        rejectedByMembershipId: membership.id,
        reason: "Current candidate.",
      }),
    ).rejects.toMatchObject({ code: "candidate_already_promoted" })
  })
})
