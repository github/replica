import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { DecisionModelDependencies, DecisionTrainingJobRecord } from "../types"
import { cancelDecisionTraining } from "../cancel-decision-training"
import { evaluateBuildWithDecisionModel } from "../evaluate-build-with-decision-model"
import { prepareDecisionTaskset } from "../prepare-decision-taskset"
import { processDecisionTrainingJob } from "../process-decision-training-job"
import { promoteDecisionCandidate } from "../promote-decision-candidate"
import { requestDecisionTraining } from "../request-decision-training"

const repositoryId = "11111111-1111-4111-8111-111111111111"
const membershipId = "22222222-2222-4222-8222-222222222222"
const jobId = "33333333-3333-4333-8333-333333333333"
const buildId = "44444444-4444-4444-8444-444444444444"
const tasksetDigest = `sha256:${"a".repeat(64)}`
const questionDigest = `sha256:${"b".repeat(64)}`
const exportDigest = `sha256:${"c".repeat(64)}`
const buildSetDigest = `sha256:${"d".repeat(64)}`

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
    audit: { write: vi.fn().mockResolvedValue(undefined) },
    now: () => new Date("2026-11-18T12:00:00Z"),
    prepareBuildEvaluation: vi.fn().mockResolvedValue({
      state: {},
      images: [],
      questions: {},
      questionDigest,
      screenshotSetDigest: buildSetDigest,
    }),
    prepareTaskset: vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
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
      saveCandidate: vi.fn(),
      getCandidate: vi.fn(),
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
  it("returns the existing job for a repeated idempotency key without a duplicate audit", async () => {
    const existing = job()
    const createOrGetJob = vi
      .fn()
      .mockResolvedValueOnce({ created: true, job: existing })
      .mockResolvedValueOnce({ created: false, job: existing })
    const writeAudit = vi.fn().mockResolvedValue(undefined)
    const deps = dependencies({
      audit: { write: writeAudit },
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
    expect(writeAudit).toHaveBeenCalledOnce()
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
    const archive = new Uint8Array([...trainingExport, ...builds])
    const repeatableReviewSnapshotDigest = `sha256:${"e".repeat(64)}`

    const prepared = await prepareDecisionTaskset(
      { repositoryId, actorMembershipId: membershipId },
      {
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
          archive,
          questionDigest,
          tasksetDigest: sha256(archive),
        }),
      },
    )

    expect(prepared).toMatchObject({
      consentGrantId: "consent-1",
      exportDigest: sha256(trainingExport),
      repeatableReviewSnapshotDigest,
      buildSetDigest: sha256(builds),
      questionDigest,
      tasksetDigest: sha256(archive),
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
        bytes: new Uint8Array([1, 2, 3]),
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
    })
  })

  it("persists candidate references and usage when polling reaches success", async () => {
    const submitted = job({
      state: "RUNNING",
      runtimeJobId: "runtime-job-1",
      runtimeTasksetId: "runtime-taskset-1",
    })
    const updateJobState = vi.fn().mockResolvedValue(job({ state: "SUCCEEDED" }))
    const saveCandidate = vi.fn().mockResolvedValue({
      id: "candidate-1",
      repositoryId,
      runtimeCandidateId: "runtime-candidate-1",
      tasksetDigest,
    })
    const deps = dependencies({
      runtime: {
        ...dependencies().runtime,
        getTrainingJob: vi.fn().mockResolvedValue({
          id: "runtime-job-1",
          state: "succeeded",
          tasksetDigest,
          candidateId: "runtime-candidate-1",
          usage: { quantity: "12", unit: "gpu-second" },
        }),
        getCandidate: vi.fn().mockResolvedValue({
          id: "runtime-candidate-1",
          tasksetDigest,
          manifestDigest: `sha256:${"5".repeat(64)}`,
          evaluationDigest: `sha256:${"6".repeat(64)}`,
          productionEligible: true,
          evidence: { meanRewardDelta: 0.2, calibrationErrorDelta: -0.1 },
          usage: { quantity: "20", unit: "gpu-second" },
        }),
      },
      store: {
        ...dependencies().store,
        getJob: vi.fn().mockResolvedValue(submitted),
        saveCandidate,
        updateJobState,
      },
    })

    await expect(processDecisionTrainingJob({ repositoryId, jobId }, deps)).resolves.toMatchObject({
      terminal: true,
      job: { state: "SUCCEEDED" },
    })

    expect(saveCandidate).toHaveBeenCalledWith({
      repositoryId,
      trainingJobId: jobId,
      runtimeCandidateId: "runtime-candidate-1",
      tasksetDigest,
      manifestDigest: `sha256:${"5".repeat(64)}`,
      evaluationDigest: `sha256:${"6".repeat(64)}`,
      productionEligible: true,
      meanRewardDelta: 0.2,
      calibrationErrorDelta: -0.1,
      usage: { quantity: "20", unit: "gpu-second" },
    })
    expect(updateJobState).toHaveBeenCalledWith({
      jobId,
      state: "SUCCEEDED",
      candidateRuntimeId: "runtime-candidate-1",
      usage: { quantity: "12", unit: "gpu-second" },
    })
  })

  it("cancels the runtime job idempotently and records the administrator action", async () => {
    const running = job({ state: "RUNNING", runtimeJobId: "runtime-job-1" })
    const cancelTrainingJob = vi.fn().mockResolvedValue({
      id: "runtime-job-1",
      state: "cancelled",
      tasksetDigest,
    })
    const writeAudit = vi.fn().mockResolvedValue(undefined)
    const deps = dependencies({
      audit: { write: writeAudit },
      runtime: {
        ...dependencies().runtime,
        cancelTrainingJob,
      },
      store: {
        ...dependencies().store,
        getJob: vi.fn().mockResolvedValue(running),
        updateJobState: vi.fn().mockResolvedValue(job({ state: "CANCELLED" })),
      },
    })

    await expect(
      cancelDecisionTraining({ repositoryId, jobId, actorMembershipId: membershipId }, deps),
    ).resolves.toMatchObject({ state: "CANCELLED" })

    expect(cancelTrainingJob).toHaveBeenCalledWith({
      id: "runtime-job-1",
      idempotencyKey: "repository-1:training-1:cancel",
    })
    expect(writeAudit).toHaveBeenCalledWith({
      type: "decision_training",
      outcome: "cancelled",
      actorMembershipId: membershipId,
      repositoryId,
      jobId,
    })
  })

  it("rejects promotion when the runtime generation changed after Hub's read", async () => {
    const promote = vi.fn()
    const savePromotion = vi.fn()
    const writeAudit = vi.fn()
    const deps = dependencies({
      audit: { write: writeAudit },
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
    expect(writeAudit).not.toHaveBeenCalled()
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
})
