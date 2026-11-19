import { describe, expect, it, vi } from "vitest"

import { DecisionRuntimeError } from "../../../integrations/decision-runtime/create-decision-runtime-client/errors.ts"
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
    trainingExportId: "export_training",
    evidenceDigest: `sha256:${"9".repeat(64)}`,
    exportDigest: `sha256:${"a".repeat(64)}`,
    repeatableReviewSnapshotDigest: `sha256:${"e".repeat(64)}`,
    questionDigest: `sha256:${"b".repeat(64)}`,
    buildSetDigest: `sha256:${"c".repeat(64)}`,
    tasksetDigest: `sha256:${"d".repeat(64)}`,
    candidateRuntimeId: null,
    failureCode: null,
    createdAt: new Date("2026-11-18T12:00:00Z"),
  }
  return {
    authorization: { requireRepositoryAdministrator: vi.fn() },
    now: () => new Date("2026-11-18T12:05:00Z"),
    withControlLock: (operation) => operation(new AbortController().signal),
    preflightTaskset: vi.fn(),
    hasTrainingConsent: vi.fn().mockResolvedValue(true),
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
        evidence: {
          baselineMeanReward: 0.5,
          candidateMeanReward: 0.6,
          meanRewardDelta: 0.1,
          baselineCalibrationError: 0.2,
          candidateCalibrationError: 0.19,
          calibrationErrorDelta: -0.01,
          learningMetrics: [],
        },
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
      markJobSubmitting: vi.fn(),
      requestCancellation: vi.fn(),
      completeAdministratorCancellation: vi.fn(),
      updateJobState: vi
        .fn()
        .mockImplementation((input: { state: DecisionTrainingJobRecord["state"] }) =>
          Promise.resolve({ ...trainingJob, state: input.state }),
        ),
      completeJobWithCandidate: vi.fn().mockResolvedValue({
        candidate: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          repositoryId,
          runtimeCandidateId: "candidate_runtime",
          tasksetDigest: `sha256:${"d".repeat(64)}`,
          rejectedAt: null,
        },
        job: { ...trainingJob, state: "SUCCEEDED" },
      }),
      getCandidate: vi.fn(),
      rejectCandidate: vi.fn(),
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

  it("finishes pre-submission work when the runtime reports deletion revocation", async () => {
    const input = dependencies("RUNNING")
    const job = await input.store.getJob(repositoryId, jobId)
    if (!job) throw new Error("Expected the training job fixture.")
    const getJob = vi.fn().mockResolvedValue({
      ...job,
      state: "SUBMITTING",
    })
    const prepareTaskset = vi
      .fn()
      .mockRejectedValue(
        new DecisionRuntimeError(
          "deletion_revoked",
          "The decision runtime rejected revoked training data.",
        ),
      )
    const updateJobState = vi
      .fn()
      .mockImplementation((update: { state: DecisionTrainingJobRecord["state"] }) =>
        Promise.resolve({ ...job, state: update.state }),
      )
    input.store.getJob = getJob
    input.prepareTaskset = prepareTaskset
    input.store.updateJobState = updateJobState
    const processors = createDecisionModelJobProcessors({
      databaseUrl: "postgresql://localhost/replica",
      dependencies: input,
      database: { decisionTrainingJob: {} } as never,
      logger: { child: () => ({}) } as never,
    })

    await expect(processors.run.process({ repositoryId, jobId })).resolves.toBeUndefined()
    expect(updateJobState).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        state: "CANCELLED",
        failureCode: "deletion_revoked",
      }),
    )
  })

  it("continues reconciling withdrawals after one deletion fails", async () => {
    const input = dependencies("RUNNING")
    const withdrawals = [
      {
        repositoryId,
        actorMembershipId: "11111111-1111-4111-8111-111111111111",
        actorLogin: "mona",
        selectors: { grantId: "grant-failed" },
        reason: "Withdrawn.",
        idempotencyKey: "withdrawal-failed",
      },
      {
        repositoryId,
        actorMembershipId: "11111111-1111-4111-8111-111111111111",
        actorLogin: "mona",
        selectors: { grantId: "grant-succeeded" },
        reason: "Withdrawn.",
        idempotencyKey: "withdrawal-succeeded",
        authorizationAlreadyEstablished: true,
      },
    ]
    input.listTrainingWithdrawals = vi.fn().mockResolvedValue(withdrawals)
    input.store.createOrGetDeletion = vi
      .fn()
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce({
        id: "deletion-2",
        runtimeDeletionId: null,
        state: "PENDING",
      })
    input.store.saveRuntimeCopies = vi.fn()
    input.store.updateDeletionReceipt = vi.fn()
    input.store.listPendingDeletions = vi.fn().mockResolvedValue([])
    Object.assign(input.runtime!, {
      listRuntimeCopies: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      requestDeletion: vi.fn().mockResolvedValue({
        id: "runtime-deletion-2",
        state: "completed",
        pendingItems: [],
        failures: [],
        completedAt: "2026-11-18T12:06:00.000Z",
      }),
      getDeletion: vi.fn(),
    })
    const warn = vi.fn()
    const processors = createDecisionModelJobProcessors({
      databaseUrl: "postgresql://localhost/replica",
      dependencies: input,
      database: { decisionTrainingJob: {} } as never,
      logger: { warn, child: () => ({}) } as never,
    })

    await expect(processors.reconcileDeletions.process({})).resolves.toBeUndefined()
    expect(input.store.createOrGetDeletion).toHaveBeenCalledTimes(2)
    expect(input.authorization.requireRepositoryAdministrator).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "withdrawal-failed" }),
      "Decision runtime withdrawal reconciliation failed",
    )
  })
})
