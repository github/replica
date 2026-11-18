import { describe, expect, it, vi } from "vitest"

import { decisionTrainingRecoverySchedule } from "../jobs/recover-decision-training.ts"
import type { DecisionModelDependencies, DecisionTrainingJobRecord } from "../types.ts"
import { createDecisionModelJobProcessors } from "./index.ts"

const repositoryId = "11111111-2222-4333-8444-555555555555"
const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

function dependencies(state: "RUNNING" | "SUCCEEDED"): DecisionModelDependencies {
  const trainingJob: DecisionTrainingJobRecord = {
    id: jobId,
    repositoryId,
    requestedByMembershipId: null,
    idempotencyKey: "request",
    runtimeJobId: "job_runtime",
    runtimeTasksetId: "taskset_runtime",
    configurationGeneration: 1,
    state: "SUBMITTED",
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
    candidateRuntimeId: null,
    createdAt: new Date("2026-11-18T12:00:00Z"),
  }
  return {
    authorization: { requireRepositoryAdministrator: vi.fn() },
    audit: { write: vi.fn() },
    now: () => new Date("2026-11-18T12:05:00Z"),
    prepareTaskset: vi.fn(),
    prepareBuildEvaluation: vi.fn(),
    runtime: {
      transferTaskset: vi.fn(),
      submitTraining: vi.fn(),
      getTrainingJob: vi.fn().mockResolvedValue({
        id: "job_runtime",
        state: state === "RUNNING" ? "running" : "succeeded",
        tasksetDigest: `sha256:${"d".repeat(64)}`,
        ...(state === "SUCCEEDED" ? { candidateId: "candidate_runtime" } : {}),
      }),
      cancelTrainingJob: vi.fn(),
      getCandidate: vi.fn().mockResolvedValue({
        id: "candidate_runtime",
        tasksetDigest: `sha256:${"d".repeat(64)}`,
        manifestDigest: `sha256:${"e".repeat(64)}`,
        evaluationDigest: `sha256:${"f".repeat(64)}`,
        productionEligible: true,
        evidence: { meanRewardDelta: 0.1, calibrationErrorDelta: -0.01 },
      }),
      getPromotion: vi.fn(),
      promote: vi.fn(),
      rollback: vi.fn(),
      evaluate: vi.fn(),
    },
    store: {
      getConfiguration: vi.fn().mockResolvedValue({
        enabled: true,
        generation: 1,
        backend: "fixture",
        maxUpdates: 8,
        maxSeconds: 300,
        monthlyBudgetCredits: "10",
      }),
      getMonthlyUsageCredits: vi.fn(),
      createOrGetJob: vi.fn(),
      getJob: vi.fn().mockResolvedValue(trainingJob),
      markJobSubmitted: vi.fn(),
      updateJobState: vi
        .fn()
        .mockImplementation((input: { state: DecisionTrainingJobRecord["state"] }) =>
          Promise.resolve({ ...trainingJob, state: input.state }),
        ),
      saveCandidate: vi.fn().mockResolvedValue({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        repositoryId,
        runtimeCandidateId: "candidate_runtime",
        tasksetDigest: `sha256:${"d".repeat(64)}`,
      }),
      getCandidate: vi.fn(),
      getPromotion: vi.fn(),
      savePromotion: vi.fn(),
      saveBuildEvaluation: vi.fn(),
    },
  }
}

describe("createDecisionModelJobProcessors()", () => {
  it("uses one stable one-minute recovery schedule", () => {
    expect(decisionTrainingRecoverySchedule).toMatchObject({
      id: "decision-training-recovery",
      payload: {},
      repeat: { every: 60_000 },
    })
  })

  it("keeps a running runtime job retryable for bounded polling", async () => {
    const processors = createDecisionModelJobProcessors({
      databaseUrl: "postgresql://localhost/replica",
      dependencies: dependencies("RUNNING"),
      database: { decisionTrainingJob: {} } as never,
      logger: { child: () => ({}) } as never,
    })

    await expect(processors.run.process({ repositoryId, jobId })).rejects.toThrow(
      "Decision training is still running.",
    )
  })

  it("finishes polling after the candidate reference is persisted", async () => {
    const processors = createDecisionModelJobProcessors({
      databaseUrl: "postgresql://localhost/replica",
      dependencies: dependencies("SUCCEEDED"),
      database: { decisionTrainingJob: {} } as never,
      logger: { child: () => ({}) } as never,
    })

    await expect(processors.run.process({ repositoryId, jobId })).resolves.toBeUndefined()
  })
})
