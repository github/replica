import { describe, expect, it } from "vitest"

import {
  decisionModelConfigurationResponseSchema,
  decisionModelOverviewResponseSchema,
  decisionTrainingMutationResponseSchema,
} from "."

const digest = `sha256:${"a".repeat(64)}`

function overview() {
  return {
    preflight: {
      state: "ready" as const,
      counts: {
        prototypes: 2,
        builds: 5,
        pages: 8,
        screenshots: 32,
        questions: 7,
        samples: 43,
        tasks: 43,
        train: 27,
        dev: 8,
        test: 8,
        follows: 24,
        breaks: 19,
      },
      warnings: [],
      reasons: [],
      digests: {
        export: digest,
        reviewSnapshot: digest,
        buildSet: digest,
        questionSet: digest,
        taskset: digest,
      },
    },
    configuration: {
      enabled: true,
      generation: 3,
      backend: "customer-runtime",
      maxUpdates: 8,
      maxSeconds: 300,
      monthlyBudgetCredits: "10.5",
    },
    jobs: [
      {
        id: "11111111-2222-4333-8444-555555555555",
        state: "succeeded" as const,
        tasksetDigest: digest,
        runtimeJobId: "runtime-job-1",
        candidateRuntimeId: "candidate-1",
        failureCode: null,
        createdAt: "2026-11-11T18:00:00Z",
        finishedAt: "2026-11-11T18:04:30Z",
      },
    ],
    candidates: [
      {
        id: "22222222-3333-4444-8555-666666666666",
        runtimeCandidateId: "candidate-1",
        tasksetDigest: digest,
        productionEligible: true,
        baselineMeanReward: "0.61",
        candidateMeanReward: "0.79",
        meanRewardDelta: "0.18",
        baselineCalibrationError: "0.2",
        candidateCalibrationError: "0.17",
        calibrationErrorDelta: "-0.03",
        learningMetrics: [
          {
            learningId: "learning-1",
            baselineBalancedAccuracy: 0.5,
            candidateBalancedAccuracy: 0.75,
            delta: 0.25,
            direction: "gain" as const,
          },
        ],
        durationSeconds: 270,
        usage: [
          {
            connector: "customer-gpu",
            kind: "training_credits",
            quantity: 3.5,
            unit: "credits",
            cost: 1.25,
            currency: "USD",
            source: "runtime",
            metadata: {},
          },
        ],
        rejection: null,
        createdAt: "2026-11-11T18:04:30Z",
      },
    ],
    promotion: {
      candidateId: "22222222-3333-4444-8555-666666666666",
      runtimeCandidateId: "candidate-1",
      generation: 2,
      operation: "promote" as const,
      rollbackAvailable: true,
    },
    promotionHistory: [],
    evaluationBuilds: [
      {
        id: "33333333-4444-4555-8666-777777777777",
        number: 42,
        prototype: {
          id: "1",
          name: "Settings",
          branchName: "settings",
        },
      },
    ],
    evaluations: [],
    deletions: [],
  }
}

describe("Decision-model contracts", () => {
  it("accepts only the persisted control-plane overview fields", () => {
    const response = overview()

    expect(decisionModelOverviewResponseSchema.parse(response)).toEqual(response)
    expect(
      decisionModelOverviewResponseSchema.safeParse({
        ...response,
        candidates: response.candidates.map((candidate) => ({
          ...candidate,
          inventedProof: true,
        })),
      }).success,
    ).toBe(false)
  })

  it("bounds the successful Builds offered for evaluation", () => {
    const response = overview()

    expect(decisionModelOverviewResponseSchema.parse(response).evaluationBuilds).toEqual(
      response.evaluationBuilds,
    )
    expect(
      decisionModelOverviewResponseSchema.safeParse({
        ...response,
        evaluationBuilds: Array.from({ length: 51 }, (_, index) => ({
          id: `${String(index).padStart(8, "0")}-4444-4555-8666-777777777777`,
          number: index + 1,
          prototype: {
            id: "1",
            name: "Settings",
            branchName: "settings",
          },
        })),
      }).success,
    ).toBe(false)
  })

  it("keeps repository training settings within the supported bounds", () => {
    const configuration = overview().configuration

    expect(
      decisionModelConfigurationResponseSchema.parse({
        ...configuration,
        maxUpdates: 1,
        maxSeconds: 1,
        monthlyBudgetCredits: "0",
      }),
    ).toMatchObject({ maxUpdates: 1, maxSeconds: 1, monthlyBudgetCredits: "0" })
    expect(
      decisionModelConfigurationResponseSchema.parse({
        ...configuration,
        maxUpdates: 100_000,
        maxSeconds: 86_400,
        monthlyBudgetCredits: "999.123456789",
      }),
    ).toMatchObject({
      maxUpdates: 100_000,
      maxSeconds: 86_400,
      monthlyBudgetCredits: "999.123456789",
    })

    for (const invalid of [
      { ...configuration, maxUpdates: 0 },
      { ...configuration, maxUpdates: 100_001 },
      { ...configuration, maxSeconds: 0 },
      { ...configuration, maxSeconds: 86_401 },
      { ...configuration, monthlyBudgetCredits: "-1" },
      { ...configuration, monthlyBudgetCredits: "1.1234567890" },
      { ...configuration, backend: "Fixture Backend" },
    ]) {
      expect(decisionModelConfigurationResponseSchema.safeParse(invalid).success).toBe(false)
    }
  })

  it("normalizes the server-shaped uppercase cancellation state", () => {
    expect(
      decisionTrainingMutationResponseSchema.parse({
        id: "11111111-2222-4333-8444-555555555555",
        state: "CANCELLED",
        repositoryId: "repository-1",
      }),
    ).toMatchObject({
      id: "11111111-2222-4333-8444-555555555555",
      state: "cancelled",
    })
  })
})
