import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { DecisionModelDependencies, DecisionTrainingJobRecord } from "../types"
import { cancelDecisionTraining } from "../cancel-decision-training"
import { evaluateBuildWithDecisionModel } from "../evaluate-build-with-decision-model"
import { preflightDecisionTaskset, prepareDecisionTaskset } from "../prepare-decision-taskset"
import { processDecisionTrainingJob } from "../process-decision-training-job"
import { promoteDecisionCandidate } from "../promote-decision-candidate"
import { rejectDecisionCandidate } from "../reject-decision-candidate"
import { requestDecisionTraining } from "../request-decision-training"
import { rollbackDecisionCandidate } from "../rollback-decision-candidate"

const repositoryId = "11111111-1111-4111-8111-111111111111"
const membershipId = "22222222-2222-4222-8222-222222222222"
const jobId = "33333333-3333-4333-8333-333333333333"
const buildId = "44444444-4444-4444-8444-444444444444"
const tasksetDigest = `sha256:${"a".repeat(64)}`
const questionDigest = `sha256:${"b".repeat(64)}`
const exportDigest = `sha256:${"c".repeat(64)}`
const buildSetDigest = `sha256:${"d".repeat(64)}`
const tasksetUpload = {
  schemaVersion: "replica.decision-taskset-upload/v1" as const,
  manifest: { questionDigest },
  tasks: [{ id: "task-1" }],
  images: [
    {
      path: "screenshots/home.png",
      mediaType: "image/png",
      digest: `sha256:${"f".repeat(64)}`,
      dataBase64: "AQID",
    },
  ],
}

function job(overrides: Partial<DecisionTrainingJobRecord> = {}): DecisionTrainingJobRecord {
  return {
    id: jobId,
    repositoryId,
    requestedByMembershipId: membershipId,
    idempotencyKey: "repository-1:training-1",
    runtimeJobId: null,
    runtimeTasksetId: null,
    configurationGeneration: 3,
    state: "QUEUED",
    backend: "customer-gpu",
    maxUpdates: 500,
    maxSeconds: 1_800,
    budgetCredits: "100",
    consentGrantId: "consent-1",
    exportDigest,
    repeatableReviewSnapshotDigest: `sha256:${"e".repeat(64)}`,
    questionDigest,
    buildSetDigest,
    tasksetDigest,
    candidateRuntimeId: null,
    createdAt: new Date("2026-11-18T12:00:00Z"),
    ...overrides,
  }
}

function dependencies(overrides: Partial<DecisionModelDependencies> = {}) {
  const base: DecisionModelDependencies = {
    authorization: {
      requireRepositoryAdministrator: vi.fn().mockResolvedValue(undefined),
    },
    now: () => new Date("2026-11-18T12:00:00Z"),
    withControlLock: (operation) => operation(new AbortController().signal),
    preflightTaskset: vi.fn().mockResolvedValue({
      counts: { prototypes: 0, builds: 0, screenshots: 0, questions: 0, samples: 0 },
      warnings: [],
    }),
    prepareBuildEvaluation: vi.fn().mockResolvedValue({
      state: {},
      images: [],
      questions: {},
      route: "/",
      views: [],
      questionDigest,
      screenshotSetDigest: buildSetDigest,
    }),
    prepareTaskset: vi.fn().mockResolvedValue({
      upload: tasksetUpload,
      consentGrantId: "consent-1",
      exportDigest,
      repeatableReviewSnapshotDigest: `sha256:${"e".repeat(64)}`,
      questionDigest,
      buildSetDigest,
      tasksetDigest,
    }),
    runtime: {
      transferTaskset: vi.fn(),
      submitTraining: vi.fn(),
      getTrainingJob: vi.fn(),
      cancelTrainingJob: vi.fn(),
      getCandidate: vi.fn(),
      getPromotion: vi.fn(),
      promote: vi.fn(),
      rollback: vi.fn(),
      evaluate: vi.fn(),
    },
    store: {
      getConfiguration: vi.fn().mockResolvedValue({
        enabled: true,
        backend: "customer-gpu",
        maxUpdates: 500,
        maxSeconds: 1_800,
        monthlyBudgetCredits: "100",
        generation: 3,
      }),
      getMonthlyUsageCredits: vi.fn().mockResolvedValue("0"),
      createOrGetJob: vi.fn(),
      getJob: vi.fn(),
      markJobSubmitted: vi.fn(),
      updateJobState: vi.fn(),
      completeJobWithCandidate: vi.fn(),
      getCandidate: vi.fn(),
      rejectCandidate: vi.fn(),
      getPromotion: vi.fn(),
      savePromotion: vi.fn(),
      saveBuildEvaluation: vi.fn(),
    },
  }
  return { ...base, ...overrides }
}

function sha256(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

describe("decision training orchestration", () => {
  it("returns the existing job for a repeated idempotency key", async () => {
    const existing = job()
    const createOrGetJob = vi
      .fn()
      .mockResolvedValueOnce({ created: true, job: existing })
      .mockResolvedValueOnce({ created: false, job: existing })
    const deps = dependencies({
      store: { ...dependencies().store, createOrGetJob },
    })
    const input = {
      repositoryId,
      actorMembershipId: membershipId,
      idempotencyKey: "repository-1:training-1",
    }

    await expect(requestDecisionTraining(input, deps)).resolves.toEqual({
      created: true,
      job: existing,
    })
    await expect(requestDecisionTraining(input, deps)).resolves.toEqual({
      created: false,
      job: existing,
    })

    expect(createOrGetJob).toHaveBeenCalledTimes(2)
    expect(createOrGetJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: "repository-1:training-1" }),
    )
  })

  it("rejects training when the repository has reached its explicit budget", async () => {
    const prepareTaskset = vi.fn()
    const createOrGetJob = vi.fn()
    const deps = dependencies({
      prepareTaskset,
      store: {
        ...dependencies().store,
        createOrGetJob,
        getMonthlyUsageCredits: vi.fn().mockResolvedValue("100"),
      },
    })

    await expect(
      requestDecisionTraining(
        {
          repositoryId,
          actorMembershipId: membershipId,
          idempotencyKey: "budgeted-request",
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "budget_exceeded" })

    expect(prepareTaskset).not.toHaveBeenCalled()
    expect(createOrGetJob).not.toHaveBeenCalled()
  })

  it("pins consent, export, repeatable review, Build, question, and taskset digests", async () => {
    const trainingExport = new TextEncoder().encode("review outcomes")
    const builds = new TextEncoder().encode("screenshots and artifact boundaries")
    const repeatableReviewSnapshotDigest = `sha256:${"e".repeat(64)}`

    const prepared = await prepareDecisionTaskset(
      { repositoryId, actorMembershipId: membershipId },
      {
        preflight: vi.fn(),
        exportTrainingEvidence: vi.fn().mockResolvedValue({
          bytes: trainingExport,
          consentGrantId: "consent-1",
          digest: sha256(trainingExport),
          repeatableReviewSnapshotDigest,
        }),
        readBuildArtifacts: vi.fn().mockResolvedValue({
          bytes: builds,
          digest: sha256(builds),
          complete: true,
        }),
        createTaskset: vi.fn().mockResolvedValue({
          upload: tasksetUpload,
          questionDigest,
          tasksetDigest,
        }),
      },
    )

    expect(prepared).toMatchObject({
      consentGrantId: "consent-1",
      exportDigest: sha256(trainingExport),
      repeatableReviewSnapshotDigest,
      buildSetDigest: sha256(builds),
      questionDigest,
      tasksetDigest,
      upload: tasksetUpload,
    })
  })

  it("returns exact taskset-source preflight counts and warnings without fallback values", async () => {
    const preflight = {
      counts: {
        prototypes: 2,
        builds: 5,
        screenshots: 11,
        questions: 7,
        samples: 43,
      },
      warnings: [
        {
          code: "missing_repeatable_reviews",
          message: "Three screenshots do not have repeatable review outcomes.",
          count: 3,
        },
        {
          code: "single_theme",
          message: "The taskset covers only one theme.",
        },
      ],
    }
    const source = {
      preflight: vi.fn().mockResolvedValue(preflight),
      exportTrainingEvidence: vi.fn(),
      readBuildArtifacts: vi.fn(),
      createTaskset: vi.fn(),
    }

    await expect(
      preflightDecisionTaskset({ repositoryId, actorMembershipId: membershipId }, source),
    ).resolves.toEqual(preflight)
    expect(source.preflight).toHaveBeenCalledWith({
      repositoryId,
      actorMembershipId: membershipId,
    })
  })

  it.each([
    ["tasksetDigest", `sha256:${"1".repeat(64)}`],
    ["questionDigest", `sha256:${"2".repeat(64)}`],
    ["exportDigest", `sha256:${"3".repeat(64)}`],
    ["buildSetDigest", `sha256:${"4".repeat(64)}`],
    ["repeatableReviewSnapshotDigest", `sha256:${"8".repeat(64)}`],
  ] as const)("fails before transfer when the pinned %s drifts", async (field, changedValue) => {
    const updateJobState = vi
      .fn()
      .mockImplementation(
        (input: { state: DecisionTrainingJobRecord["state"]; failureCode?: string }) =>
          Promise.resolve(job({ state: input.state })),
      )
    const transferTaskset = vi.fn()
    const deps = dependencies({
      prepareTaskset: vi.fn().mockResolvedValue({
        upload: tasksetUpload,
        consentGrantId: "consent-1",
        exportDigest,
        repeatableReviewSnapshotDigest: `sha256:${"e".repeat(64)}`,
        questionDigest,
        buildSetDigest,
        tasksetDigest,
        [field]: changedValue,
      }),
      store: {
        ...dependencies().store,
        getJob: vi.fn().mockResolvedValue(job()),
        updateJobState,
      },
      runtime: { ...dependencies().runtime, transferTaskset },
    })

    await expect(processDecisionTrainingJob({ repositoryId, jobId }, deps)).resolves.toMatchObject({
      terminal: true,
      job: { state: "FAILED" },
    })

    expect(transferTaskset).not.toHaveBeenCalled()
    expect(updateJobState).toHaveBeenCalledWith({
      jobId,
      state: "FAILED",
      failureCode: "taskset_drift",
      audit: {
        actorMembershipId: membershipId,
        outcome: "failed",
        reason: "taskset_drift",
        repositoryId,
      },
    })
  })

  it("cancels a runtime job when Hub cancellation wins the submission race", async () => {
    const cancelTrainingJob = vi.fn().mockResolvedValue({
      id: "runtime-job-1",
      state: "cancelled",
      tasksetDigest,
      usage: [
        {
          connector: "customer-gpu",
          kind: "training_credits",
          quantity: 1.5,
          unit: "credits",
          cost: 0.15,
          currency: "USD",
          source: "customer-runtime",
          metadata: {},
        },
      ],
    })
    const getTrainingJob = vi.fn()
    const deps = dependencies({
      runtime: {
        ...dependencies().runtime,
        transferTaskset: vi.fn().mockResolvedValue({
          reference: "taskset:runtime-taskset-1",
          tasksetDigest,
        }),
        submitTraining: vi.fn().mockResolvedValue({
          id: "runtime-job-1",
          state: "queued",
          tasksetDigest,
        }),
        cancelTrainingJob,
        getTrainingJob,
      },
      store: {
        ...dependencies().store,
        getJob: vi.fn().mockResolvedValue(job()),
        markJobSubmitted: vi.fn().mockResolvedValue(job({ state: "CANCELLED" })),
      },
    })

    await expect(processDecisionTrainingJob({ repositoryId, jobId }, deps)).resolves.toMatchObject({
      terminal: true,
      job: { state: "CANCELLED" },
    })

    expect(cancelTrainingJob).toHaveBeenCalledWith({
      id: "runtime-job-1",
      idempotencyKey: "repository-1:training-1:cancel-after-submit",
    })
    expect(getTrainingJob).not.toHaveBeenCalled()
  })

  it("persists absolute and per-learning candidate evidence with exact usage and cost", async () => {
    const submitted = job({
      state: "RUNNING",
      runtimeJobId: "runtime-job-1",
      runtimeTasksetId: "runtime-taskset-1",
    })
    const completeJobWithCandidate = vi.fn().mockResolvedValue({
      candidate: {
        id: "candidate-1",
        repositoryId,
        runtimeCandidateId: "runtime-candidate-1",
        tasksetDigest,
        rejectedAt: null,
      },
      job: job({ state: "SUCCEEDED" }),
    })
    const deps = dependencies({
      runtime: {
        ...dependencies().runtime,
        getTrainingJob: vi.fn().mockResolvedValue({
          id: "runtime-job-1",
          state: "succeeded",
          tasksetDigest,
          candidateId: "runtime-candidate-1",
          startedAt: "2026-11-18T12:00:00.000Z",
          completedAt: "2026-11-18T12:02:05.000Z",
          usage: [
            {
              connector: "customer-gpu",
              kind: "training_credits",
              quantity: 12,
              unit: "credits",
              cost: 1.2,
              currency: "USD",
              source: "customer-runtime",
              metadata: {},
            },
          ],
        }),
        getCandidate: vi.fn().mockResolvedValue({
          id: "runtime-candidate-1",
          tasksetDigest,
          manifestDigest: `sha256:${"5".repeat(64)}`,
          evaluationDigest: `sha256:${"6".repeat(64)}`,
          productionEligible: true,
          evidence: {
            baselineMeanReward: 0.61,
            candidateMeanReward: 0.81,
            meanRewardDelta: 0.2,
            baselineCalibrationError: 0.19,
            candidateCalibrationError: 0.09,
            calibrationErrorDelta: -0.1,
            learningMetrics: [
              {
                learningId: "learning-gain",
                baselineBalancedAccuracy: 0.5,
                candidateBalancedAccuracy: 0.8,
                delta: 0.3,
                direction: "gain",
              },
              {
                learningId: "learning-regression",
                baselineBalancedAccuracy: 0.9,
                candidateBalancedAccuracy: 0.7,
                delta: -0.2,
                direction: "regression",
              },
            ],
          },
          usage: [
            {
              connector: "customer-gpu",
              kind: "training_credits",
              quantity: 20.25,
              unit: "credits",
              cost: 3.75,
              currency: "USD",
              source: "customer-runtime",
              metadata: {},
            },
          ],
        }),
      },
      store: {
        ...dependencies().store,
        getJob: vi.fn().mockResolvedValue(submitted),
        completeJobWithCandidate,
      },
    })

    await expect(processDecisionTrainingJob({ repositoryId, jobId }, deps)).resolves.toMatchObject({
      terminal: true,
      job: { state: "SUCCEEDED" },
    })

    expect(completeJobWithCandidate).toHaveBeenCalledWith({
      repositoryId,
      trainingJobId: jobId,
      runtimeCandidateId: "runtime-candidate-1",
      tasksetDigest,
      manifestDigest: `sha256:${"5".repeat(64)}`,
      evaluationDigest: `sha256:${"6".repeat(64)}`,
      productionEligible: true,
      baselineMeanReward: 0.61,
      candidateMeanReward: 0.81,
      meanRewardDelta: 0.2,
      baselineCalibrationError: 0.19,
      candidateCalibrationError: 0.09,
      calibrationErrorDelta: -0.1,
      learningMetrics: [
        {
          learningId: "learning-gain",
          baselineBalancedAccuracy: 0.5,
          candidateBalancedAccuracy: 0.8,
          delta: 0.3,
          direction: "gain",
        },
        {
          learningId: "learning-regression",
          baselineBalancedAccuracy: 0.9,
          candidateBalancedAccuracy: 0.7,
          delta: -0.2,
          direction: "regression",
        },
      ],
      durationSeconds: 125,
      usage: [
        {
          connector: "customer-gpu",
          kind: "training_credits",
          quantity: 20.25,
          unit: "credits",
          cost: 3.75,
          currency: "USD",
          source: "customer-runtime",
          metadata: {},
        },
      ],
      jobUsage: [
        {
          connector: "customer-gpu",
          kind: "training_credits",
          quantity: 12,
          unit: "credits",
          cost: 1.2,
          currency: "USD",
          source: "customer-runtime",
          metadata: {},
        },
      ],
      actorMembershipId: membershipId,
    })
  })

  it("cancels the runtime job idempotently and records the administrator action", async () => {
    const running = job({ state: "RUNNING", runtimeJobId: "runtime-job-1" })
    const cancelTrainingJob = vi.fn().mockResolvedValue({
      id: "runtime-job-1",
      state: "cancelled",
      tasksetDigest,
      usage: [
        {
          connector: "customer-gpu",
          kind: "training_credits",
          quantity: 1.5,
          unit: "credits",
          cost: 0.15,
          currency: "USD",
          source: "customer-runtime",
          metadata: {},
        },
      ],
    })
    const updateJobState = vi.fn().mockResolvedValue(job({ state: "CANCELLED" }))
    const deps = dependencies({
      runtime: {
        ...dependencies().runtime,
        cancelTrainingJob,
      },
      store: {
        ...dependencies().store,
        getJob: vi.fn().mockResolvedValue(running),
        updateJobState,
      },
    })

    await expect(
      cancelDecisionTraining({ repositoryId, jobId, actorMembershipId: membershipId }, deps),
    ).resolves.toMatchObject({ state: "CANCELLED" })

    expect(cancelTrainingJob).toHaveBeenCalledWith({
      id: "runtime-job-1",
      idempotencyKey: "repository-1:training-1:cancel",
    })
    expect(updateJobState).toHaveBeenCalledWith({
      jobId,
      state: "CANCELLED",
      usage: [
        {
          connector: "customer-gpu",
          kind: "training_credits",
          quantity: 1.5,
          unit: "credits",
          cost: 0.15,
          currency: "USD",
          source: "customer-runtime",
          metadata: {},
        },
      ],
      audit: {
        actorMembershipId: membershipId,
        outcome: "cancelled",
        repositoryId,
      },
    })
  })

  it("rejects promotion when the runtime generation changed after Hub's read", async () => {
    const promote = vi.fn()
    const savePromotion = vi.fn()
    const deps = dependencies({
      runtime: {
        ...dependencies().runtime,
        promote,
        getPromotion: vi.fn().mockResolvedValue({
          candidateId: "other-runtime-candidate",
          generation: 5,
        }),
      },
      store: {
        ...dependencies().store,
        getCandidate: vi.fn().mockResolvedValue({
          id: "candidate-1",
          repositoryId,
          runtimeCandidateId: "runtime-candidate-1",
          tasksetDigest,
        }),
        getPromotion: vi.fn().mockResolvedValue({
          candidateId: "candidate-0",
          runtimeCandidateId: "runtime-candidate-0",
          previousCandidateId: null,
          previousRuntimeCandidateId: null,
          runtimeGeneration: 4,
        }),
        savePromotion,
      },
    })

    await expect(
      promoteDecisionCandidate(
        {
          repositoryId,
          candidateId: "candidate-1",
          actorMembershipId: membershipId,
          actorLogin: "mona",
          expectedGeneration: 4,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "promotion_stale" })

    expect(promote).not.toHaveBeenCalled()
    expect(savePromotion).not.toHaveBeenCalled()
  })

  it("persists candidate rejection through the decision-model store", async () => {
    const rejectedAt = new Date("2026-11-18T12:05:00Z")
    const rejectCandidate = vi.fn().mockResolvedValue({
      id: "candidate-1",
      repositoryId,
      runtimeCandidateId: "runtime-candidate-1",
      tasksetDigest,
      rejectedAt,
    })
    const deps = dependencies({
      store: { ...dependencies().store, rejectCandidate },
    })

    await expect(
      rejectDecisionCandidate(
        {
          repositoryId,
          candidateId: "candidate-1",
          actorMembershipId: membershipId,
          reason: "Held-out reward regressed.",
        },
        deps,
      ),
    ).resolves.toMatchObject({ rejectedAt })

    expect(rejectCandidate).toHaveBeenCalledWith({
      repositoryId,
      candidateId: "candidate-1",
      rejectedByMembershipId: membershipId,
      reason: "Held-out reward regressed.",
    })
  })

  it("does not call the runtime when a persisted candidate rejection prevents promotion", async () => {
    const promote = vi.fn()
    const getPromotion = vi.fn()
    const savePromotion = vi.fn()
    const deps = dependencies({
      runtime: { ...dependencies().runtime, promote },
      store: {
        ...dependencies().store,
        getCandidate: vi.fn().mockResolvedValue({
          id: "candidate-1",
          repositoryId,
          runtimeCandidateId: "runtime-candidate-1",
          tasksetDigest,
          rejectedAt: new Date("2026-11-18T12:05:00Z"),
        }),
        getPromotion,
        savePromotion,
      },
    })

    await expect(
      promoteDecisionCandidate(
        {
          repositoryId,
          candidateId: "candidate-1",
          actorMembershipId: membershipId,
          actorLogin: "mona",
          expectedGeneration: 4,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "candidate_rejected" })

    expect(getPromotion).not.toHaveBeenCalled()
    expect(promote).not.toHaveBeenCalled()
    expect(savePromotion).not.toHaveBeenCalled()
  })

  it("does not mutate the runtime when the rollback target is rejected", async () => {
    const rollback = vi.fn()
    const getRuntimePromotion = vi.fn()
    const deps = dependencies({
      runtime: {
        ...dependencies().runtime,
        rollback,
        getPromotion: getRuntimePromotion,
      },
      store: {
        ...dependencies().store,
        getPromotion: vi.fn().mockResolvedValue({
          candidateId: "candidate-current",
          runtimeCandidateId: "runtime-current",
          previousCandidateId: "candidate-previous",
          previousRuntimeCandidateId: "runtime-previous",
          runtimeGeneration: 4,
        }),
        getCandidate: vi.fn().mockResolvedValue({
          id: "candidate-previous",
          repositoryId,
          runtimeCandidateId: "runtime-previous",
          tasksetDigest,
          rejectedAt: new Date("2026-11-18T12:05:00Z"),
        }),
      },
    })

    await expect(
      rollbackDecisionCandidate(
        {
          repositoryId,
          actorMembershipId: membershipId,
          actorLogin: "mona",
          expectedGeneration: 4,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "candidate_rejected" })

    expect(getRuntimePromotion).not.toHaveBeenCalled()
    expect(rollback).not.toHaveBeenCalled()
  })

  it("reconciles a runtime promotion that completed before Hub saved it", async () => {
    const promote = vi.fn()
    const savePromotion = vi.fn().mockResolvedValue({
      candidateId: "candidate-1",
      runtimeCandidateId: "runtime-candidate-1",
      previousCandidateId: "candidate-0",
      previousRuntimeCandidateId: "runtime-candidate-0",
      runtimeGeneration: 5,
    })
    const deps = dependencies({
      runtime: {
        ...dependencies().runtime,
        promote,
        getPromotion: vi.fn().mockResolvedValue({
          candidateId: "runtime-candidate-1",
          generation: 5,
        }),
      },
      store: {
        ...dependencies().store,
        getCandidate: vi.fn().mockResolvedValue({
          id: "candidate-1",
          repositoryId,
          runtimeCandidateId: "runtime-candidate-1",
          tasksetDigest,
        }),
        getPromotion: vi.fn().mockResolvedValue({
          candidateId: "candidate-0",
          runtimeCandidateId: "runtime-candidate-0",
          previousCandidateId: null,
          previousRuntimeCandidateId: null,
          runtimeGeneration: 4,
        }),
        savePromotion,
      },
    })

    await expect(
      promoteDecisionCandidate(
        {
          repositoryId,
          candidateId: "candidate-1",
          actorMembershipId: membershipId,
          actorLogin: "mona",
          expectedGeneration: 4,
        },
        deps,
      ),
    ).resolves.toMatchObject({ runtimeGeneration: 5 })

    expect(promote).not.toHaveBeenCalled()
    expect(savePromotion).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: "candidate-1", runtimeGeneration: 5 }),
    )
  })

  it("does not save a Build evaluation produced by a candidate other than the promoted one", async () => {
    const base = dependencies()
    const saveBuildEvaluation = vi.fn()
    const deps = {
      ...base,
      prepareBuildEvaluation: vi.fn().mockResolvedValue({
        state: { title: "Build" },
        images: ["artifact://screenshot-1"],
        questions: { kind: "replica.questions/v1" },
        route: "/settings/profile",
        views: [{ viewport: "desktop", theme: "dark" }],
        questionDigest,
        screenshotSetDigest: buildSetDigest,
      }),
      runtime: {
        ...base.runtime,
        evaluate: vi.fn().mockResolvedValue({
          id: "evaluation-1",
          candidateId: "runtime-candidate-2",
          generation: 8,
          responseDigest: `sha256:${"7".repeat(64)}`,
          evaluations: [],
        }),
      },
      store: {
        ...base.store,
        saveBuildEvaluation,
        getPromotion: vi.fn().mockResolvedValue({
          candidateId: "candidate-1",
          runtimeCandidateId: "runtime-candidate-1",
          previousCandidateId: "candidate-0",
          previousRuntimeCandidateId: "runtime-candidate-0",
          runtimeGeneration: 8,
        }),
      },
    }

    await expect(
      evaluateBuildWithDecisionModel({ repositoryId, buildId }, deps),
    ).rejects.toMatchObject({ code: "promotion_stale" })
    expect(saveBuildEvaluation).not.toHaveBeenCalled()
  })

  it("persists page-level Build findings with learning text and the evaluated views", async () => {
    const base = dependencies()
    const saveBuildEvaluation = vi.fn().mockResolvedValue({ id: "evaluation-record-1" })
    const deps = {
      ...base,
      prepareBuildEvaluation: vi.fn().mockResolvedValue({
        state: { title: "Profile settings" },
        images: ["artifact://desktop-dark", "artifact://mobile-light"],
        questions: {
          "learning-1": {
            learning_text: "Use the compact navigation on settings pages.",
          },
        },
        route: "/settings/profile",
        views: [
          { viewport: "desktop", theme: "dark" },
          { viewport: "mobile", theme: "light" },
        ],
        questionDigest,
        screenshotSetDigest: buildSetDigest,
      }),
      runtime: {
        ...base.runtime,
        evaluate: vi.fn().mockResolvedValue({
          id: "runtime-evaluation-1",
          candidateId: "runtime-candidate-1",
          generation: 8,
          responseDigest: `sha256:${"7".repeat(64)}`,
          evaluations: [
            {
              learningId: "learning-1",
              followsProbability: 0.82,
              breaksProbability: 0.18,
            },
          ],
          usage: [
            {
              connector: "customer-gpu",
              kind: "inference_seconds",
              quantity: 2.5,
              unit: "seconds",
              cost: 0.12,
              currency: "USD",
              source: "customer-runtime",
              metadata: {},
            },
          ],
        }),
      },
      store: {
        ...base.store,
        saveBuildEvaluation,
        getPromotion: vi.fn().mockResolvedValue({
          candidateId: "candidate-1",
          runtimeCandidateId: "runtime-candidate-1",
          previousCandidateId: "candidate-0",
          previousRuntimeCandidateId: "runtime-candidate-0",
          runtimeGeneration: 8,
        }),
      },
    }

    await expect(
      evaluateBuildWithDecisionModel({ repositoryId, buildId }, deps),
    ).resolves.toMatchObject({ id: "runtime-evaluation-1" })

    expect(saveBuildEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId,
        buildId,
        candidateId: "candidate-1",
        promotionGeneration: 8,
        runtimeEvaluationId: "runtime-evaluation-1",
        summary: {
          findings: [
            {
              learning: {
                id: "learning-1",
                text: "Use the compact navigation on settings pages.",
              },
              route: "/settings/profile",
              views: [
                { viewport: "desktop", theme: "dark" },
                { viewport: "mobile", theme: "light" },
              ],
              followsProbability: 0.82,
              breaksProbability: 0.18,
            },
          ],
        },
        usage: [
          {
            connector: "customer-gpu",
            kind: "inference_seconds",
            quantity: 2.5,
            unit: "seconds",
            cost: 0.12,
            currency: "USD",
            source: "customer-runtime",
            metadata: {},
          },
        ],
      }),
    )
  })
})
