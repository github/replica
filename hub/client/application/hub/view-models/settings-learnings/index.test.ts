import { describe, expect, it } from "vitest"

import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { DecisionModelAvailability } from "@application/hub/decision-model-contracts/types"
import type { LearningsResponse } from "@application/hub/learnings-contracts/types"
import { emptyLearnings } from "@application/hub/routes/fixtures/empty-learnings"

import { settingsLearnings } from "."

const location = { pathname: "/repositories/2001/learnings", search: "" }
const tasksetDigest = `sha256:${"b".repeat(64)}`
const repository = {
  id: "2001",
  nameWithOwner: "github/prototype",
  defaultBranch: "main",
}
const workspace = {
  capabilities: {
    administerHub: true,
    createPrototypes: true,
    manageSharing: true,
    reviewPrototypes: true,
  },
  repositories: [repository],
  viewer: {
    id: "viewer-1",
    login: "mona",
    name: "Mona",
    provider: "github",
  },
} as WorkspaceResponse

function available(): DecisionModelAvailability {
  return {
    state: "available",
    overview: {
      preflight: {
        state: "ready",
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
        warnings: [
          {
            code: "missing_repeatable_reviews",
            message: "Three screenshots do not have repeatable review outcomes.",
            count: 3,
          },
        ],
        reasons: [{ code: "event-redacted", count: 2 }],
        digests: {
          export: `sha256:${"1".repeat(64)}`,
          reviewSnapshot: `sha256:${"2".repeat(64)}`,
          buildSet: `sha256:${"3".repeat(64)}`,
          questionSet: `sha256:${"4".repeat(64)}`,
          taskset: tasksetDigest,
        },
      },
      configuration: {
        enabled: true,
        generation: 3,
        backend: "fixture",
        maxUpdates: 8,
        maxSeconds: 300,
        monthlyBudgetCredits: "10",
      },
      jobs: [
        {
          id: "11111111-2222-4333-8444-555555555555",
          state: "failed",
          tasksetDigest,
          runtimeJobId: "runtime-job-1",
          candidateRuntimeId: null,
          failureCode: "runtime_unavailable",
          createdAt: "2026-11-13T16:00:00Z",
          finishedAt: "2026-11-13T16:05:00Z",
        },
        {
          id: "22222222-3333-4444-8555-666666666666",
          state: "failed",
          tasksetDigest,
          runtimeJobId: "runtime-job-2",
          candidateRuntimeId: null,
          failureCode: "taskset_drift",
          createdAt: "2026-11-12T16:00:00Z",
          finishedAt: "2026-11-12T16:01:00Z",
        },
      ],
      candidates: [
        {
          id: "33333333-4444-4555-8666-777777777777",
          runtimeCandidateId: "fixture-candidate-2",
          backend: "fixture",
          tasksetDigest,
          productionEligible: true,
          baselineMeanReward: "0.55",
          candidateMeanReward: "0.73",
          meanRewardDelta: "0.18",
          baselineCalibrationError: "0.20",
          candidateCalibrationError: "0.17",
          calibrationErrorDelta: "-0.03",
          learningMetrics: [
            {
              learningId: "learning-gain",
              baselineBalancedAccuracy: 0.5,
              candidateBalancedAccuracy: 0.75,
              delta: 0.25,
              direction: "gain",
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
      promotion: null,
      promotionHistory: [],
      evaluationBuilds: [
        {
          id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
          number: 42,
          prototype: {
            id: "1",
            name: "Settings",
            branchName: "settings",
          },
        },
      ],
      evaluations: [
        {
          id: "44444444-5555-4666-8777-888888888888",
          build: {
            id: "55555555-6666-4777-8888-999999999999",
            number: 3,
            prototypeId: "1",
          },
          model: {
            id: "33333333-4444-4555-8666-777777777777",
            runtimeCandidateId: "fixture-candidate-2",
            generation: 3,
          },
          questionDigest: `sha256:${"4".repeat(64)}`,
          screenshotSetDigest: `sha256:${"5".repeat(64)}`,
          responseDigest: `sha256:${"6".repeat(64)}`,
          findingsAvailable: true,
          findings: [
            {
              learning: { id: "learning-gain", text: null },
              route: "/settings",
              views: [{ viewport: "desktop", theme: "dark" }],
              followsProbability: 0.75,
              breaksProbability: 0.25,
              explanation: "The deleted learning text remains private.",
            },
          ],
          createdAt: "2026-11-14T16:00:00Z",
        },
      ],
      deletions: [
        {
          id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
          state: "pending",
          selectors: {
            exportId: "export-1",
            grantId: "grant-1",
            evidenceDigest: `sha256:${"7".repeat(64)}`,
            tasksetDigest,
          },
          pending: 2,
          failures: 0,
          revokedAt: "2026-11-14T17:00:00Z",
          completedAt: null,
          failureCode: null,
        },
      ],
    },
  }
}

function mockState(administerHub: boolean) {
  return {
    workspace,
    learnings: emptyLearnings(administerHub),
  }
}

describe("settingsLearnings()", () => {
  it("uses repository permissions for learning actions and Hub administration for navigation", () => {
    const state: LearningsResponse = {
      accessDenied: false,
      repository,
      capabilities: { administerHub: false, administerRepository: true },
      permissions: { viewEvidence: true, decide: true, requestRun: true },
      copilot: { state: "connected", connectedBy: null },
      automaticRunsEnabled: false,
      usageCredits: "0",
      runAvailable: true,
      loadError: null,
      identityReviewCount: 0,
      suggestions: [],
      learnings: [],
      rejected: [],
      recall: { text: "", count: 0 },
      runs: [],
    }

    const result = settingsLearnings(workspace, state, null, location, null)

    expect(result.accessDenied).toBe(false)
    if (result.accessDenied) throw new Error("Expected repository learning access.")
    expect(result.run.available).toBe(true)
    expect(result.administrationLinks).toEqual([])
    expect(result.decisionModel.state).toBe("repository-learning-only")
  })

  it("credits an edit to the person who made it", () => {
    const state: LearningsResponse = {
      accessDenied: false,
      repository,
      capabilities: { administerHub: false, administerRepository: true },
      permissions: { viewEvidence: true, decide: true, requestRun: true },
      copilot: { state: "connected", connectedBy: null },
      automaticRunsEnabled: false,
      usageCredits: "0",
      runAvailable: true,
      loadError: null,
      identityReviewCount: 0,
      suggestions: [],
      learnings: [
        {
          id: "mem_1",
          title: null,
          content: "Use one primary action.",
          digest: `sha256:${"c".repeat(64)}`,
          acceptedBy: "hubot",
          acceptedAt: "2026-11-10T12:00:00Z",
          edited: true,
          lastDecision: "edited",
          status: "recalled",
        },
      ],
      rejected: [],
      recall: { text: "", count: 0 },
      runs: [],
    }

    const result = settingsLearnings(workspace, state, null)

    if (result.accessDenied) throw new Error("Expected repository learning access.")
    expect(result.learnings[0]?.accepted).toBe("Edited by @hubot on November 10, 2026")
  })

  it("keeps Hub administration navigation for a denied repository", () => {
    const state: LearningsResponse = {
      accessDenied: true,
      repository,
      capabilities: { administerHub: true, administerRepository: false },
    }

    const result = settingsLearnings(workspace, state, null, location, null)

    expect(result.accessDenied).toBe(true)
    expect(result.administrationLinks).not.toEqual([])
    expect(result).not.toHaveProperty("library")
    expect(result).not.toHaveProperty("run")
  })

  it("keeps repository learning authority separate from Hub administrator authority", () => {
    const repositoryAdministrator = mockState(false)
    const repositoryData = settingsLearnings(
      repositoryAdministrator.workspace,
      repositoryAdministrator.learnings,
      available(),
      location,
      null,
    )

    expect(repositoryData.accessDenied).toBe(false)
    if (repositoryData.accessDenied) throw new Error("Repository learnings must remain available.")
    expect(repositoryData.decisionModel.state).toBe("repository-learning-only")

    const hubAdministrator = mockState(true)
    const hubData = settingsLearnings(
      hubAdministrator.workspace,
      hubAdministrator.learnings,
      { state: "not-configured" },
      location,
      null,
    )
    expect(hubData.accessDenied).toBe(false)
    if (hubData.accessDenied) throw new Error("The Hub administrator must receive Learnings.")
    expect(hubData.decisionModel.state).toBe("not-configured")
  })

  it("maps authoritative evidence, privacy, and deletion state", () => {
    const administrator = mockState(true)
    const data = settingsLearnings(
      administrator.workspace,
      administrator.learnings,
      available(),
      location,
      null,
    )

    expect(data.accessDenied).toBe(false)
    if (data.accessDenied || data.decisionModel.state !== "available") {
      throw new Error("The configured administrator must receive decision-model controls.")
    }
    expect(data.decisionModel.readiness.evidence).toMatch(
      /2 prototypes, 5 Builds, 8 pages, 32 screenshots, 7 questions, and 43 samples/,
    )
    expect(data.decisionModel.readiness.evidence).toMatch(
      /reserves 8 development and 8 test tasks from the 27 training tasks/,
    )
    expect(data.decisionModel.readiness.blockedReasons).toEqual([])
    expect(data.decisionModel.jobs.map((job) => job.failureKind)).toEqual(["retryable", "terminal"])
    expect(data.decisionModel.candidates[0]).toMatchObject({
      baselineMeanReward: "0.55",
      candidateMeanReward: "0.73",
      meanRewardChange: "+0.18 (improved)",
      duration: "4 minutes 30 seconds",
      usage: ["customer-gpu: 3.5 credits, $1.25"],
    })
    expect(data.decisionModel.evaluationBuilds).toEqual([
      {
        id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
        number: 42,
        label: "Settings — Build 42",
        evaluationPath:
          "/repositories/2001/learnings/decision-model/builds/77777777-8888-4999-8aaa-bbbbbbbbbbbb/evaluate",
      },
    ])
    expect(data.decisionModel.evaluations[0]?.findings[0]).toMatchObject({
      learningId: "learning-gain",
      learningText: null,
    })
    expect(data.decisionModel.deletions).toEqual([
      expect.objectContaining({
        state: "pending",
        summary: "2 pending runtime deletion items; 0 failures.",
      }),
    ])
  })
})
