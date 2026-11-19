import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app/index.ts"
import { createDecisionModelRouteDependencies } from "./create-decision-model-route-dependencies"
import type { DecisionModelRouteDependencies } from "./types.ts"

const repositoryMocks = vi.hoisted(() => ({
  findActiveRepository: vi.fn(),
  getDecisionModelOverview: vi.fn(),
  isEffectiveAdministrator: vi.fn(),
}))

vi.mock("../../../integrations/prisma/index.ts", () => ({ prisma: {} }))
vi.mock(
  "../../../repositories/decision-model-configurations/get-decision-model-overview/index.ts",
  () => ({ getDecisionModelOverview: repositoryMocks.getDecisionModelOverview }),
)
vi.mock("../../../repositories/memberships/is-effective-administrator/index.ts", () => ({
  isEffectiveAdministrator: repositoryMocks.isEffectiveAdministrator,
}))
vi.mock("../../../repositories/prototype-index/find-active-repository/index.ts", () => ({
  findActiveRepository: repositoryMocks.findActiveRepository,
}))

const repositoryId = "11111111-2222-4333-8444-555555555555"
const membershipId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const candidateId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

function dependencies(role: "MEMBER" | "ADMINISTRATOR"): DecisionModelRouteDependencies {
  return {
    applicationOrigin: "http://127.0.0.1:5173",
    currentSession: {
      restore: vi.fn().mockResolvedValue({
        membershipId,
        userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        provider: "github",
        login: "mona",
        name: "Mona",
        role,
      }),
    },
    getOverview: vi.fn().mockResolvedValue({ configuration: null }),
    saveSettings: vi.fn().mockResolvedValue({ generation: 1 }),
    requestTraining: vi.fn().mockResolvedValue({ jobId: "job" }),
    getTrainingJob: vi.fn(),
    cancelTraining: vi.fn(),
    rejectCandidate: vi.fn(),
    promote: vi.fn(),
    rollback: vi.fn(),
    evaluateBuild: vi.fn(),
  }
}

async function withApp(
  decisionModels: DecisionModelRouteDependencies,
  operation: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(createApp({ decisionModels }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

describe("decision-model routes", () => {
  it("does not expose control-plane state to a Hub member", async () => {
    const getOverview = vi.fn()
    const deps = { ...dependencies("MEMBER"), getOverview }

    await withApp(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/decision-model`, {
        headers: { cookie: "hub_session=current-session" },
      })

      expect(response.status).toBe(403)
      expect(getOverview).not.toHaveBeenCalled()
    })
  })

  it("passes bounded repository settings to the administrator contract", async () => {
    const saveSettings = vi.fn().mockResolvedValue({ generation: 1 })
    const deps = { ...dependencies("ADMINISTRATOR"), saveSettings }

    await withApp(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/decision-model`, {
        method: "PATCH",
        headers: {
          cookie: "hub_session=current-session",
          "content-type": "application/json",
          origin: "http://127.0.0.1:5173",
        },
        body: JSON.stringify({
          enabled: true,
          backend: "fixture",
          maxUpdates: 8,
          maxSeconds: 300,
          monthlyBudgetCredits: "10",
        }),
      })

      expect(response.status).toBe(200)
      expect(saveSettings).toHaveBeenCalledWith({
        repositoryId,
        actorMembershipId: membershipId,
        settings: {
          enabled: true,
          backend: "fixture",
          maxUpdates: 8,
          maxSeconds: 300,
          monthlyBudgetCredits: "10",
        },
      })
    })
  })

  it("returns authoritative decision-model overview fields without reshaping them", async () => {
    const overview = {
      preflight: {
        counts: { prototypes: 2, builds: 5, screenshots: 11, questions: 7, samples: 43 },
        warnings: [
          {
            code: "missing_repeatable_reviews",
            message: "Three screenshots do not have repeatable review outcomes.",
            count: 3,
          },
        ],
      },
      configuration: null,
      jobs: [],
      candidates: [
        {
          id: candidateId,
          runtimeCandidateId: "runtime-candidate-2",
          baselineMeanReward: "0.55",
          candidateMeanReward: "0.70",
          meanRewardDelta: "0.15",
          baselineCalibrationError: "0.20",
          candidateCalibrationError: "0.12",
          calibrationErrorDelta: "-0.08",
          learningMetrics: [
            {
              learningId: "learning-gain",
              baselineBalancedAccuracy: 0.5,
              candidateBalancedAccuracy: 0.75,
              delta: 0.25,
              direction: "gain",
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
          rejection: null,
        },
      ],
      promotion: {
        candidateId,
        runtimeCandidateId: "runtime-candidate-2",
        generation: 3,
        operation: "promote",
        rollbackAvailable: true,
      },
      promotionHistory: [
        {
          candidateId,
          runtimeCandidateId: "runtime-candidate-2",
          previousCandidateId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          previousRuntimeCandidateId: "runtime-candidate-1",
          generation: 3,
          operation: "promote",
          createdAt: "2026-11-18T12:10:00.000Z",
        },
      ],
      evaluations: [
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          model: {
            id: candidateId,
            runtimeCandidateId: "runtime-candidate-2",
            generation: 3,
          },
          findings: [
            {
              learning: {
                id: "learning-gain",
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
          createdAt: "2026-11-18T12:15:00.000Z",
        },
      ],
    }
    const deps = {
      ...dependencies("ADMINISTRATOR"),
      getOverview: vi.fn().mockResolvedValue(overview),
    }

    await withApp(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/decision-model`, {
        headers: { cookie: "hub_session=current-session" },
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual(overview)
    })
  })

  it("lists persisted runtime duration, history, and findings", async () => {
    repositoryMocks.isEffectiveAdministrator.mockResolvedValue(true)
    repositoryMocks.findActiveRepository.mockResolvedValue({ id: repositoryId })
    repositoryMocks.getDecisionModelOverview.mockResolvedValue({
      configuration: null,
      jobs: [],
      candidates: [
        {
          id: candidateId,
          runtimeCandidateId: "runtime-candidate-2",
          tasksetDigest: `sha256:${"a".repeat(64)}`,
          productionEligible: true,
          baselineMeanReward: { toString: () => "0.55" },
          candidateMeanReward: { toString: () => "0.70" },
          meanRewardDelta: { toString: () => "0.15" },
          baselineCalibrationError: { toString: () => "0.20" },
          candidateCalibrationError: { toString: () => "0.12" },
          calibrationErrorDelta: { toString: () => "-0.08" },
          learningMetrics: [],
          durationSeconds: { toNumber: () => 125 },
          usageRecords: [
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
          rejectedAt: null,
          rejectedReason: null,
          rejectedByMembershipId: null,
          createdAt: new Date("2026-11-18T12:00:00Z"),
          trainingJob: { startedAt: null, finishedAt: null },
        },
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          runtimeCandidateId: "runtime-candidate-running",
          tasksetDigest: `sha256:${"b".repeat(64)}`,
          productionEligible: false,
          baselineMeanReward: null,
          candidateMeanReward: null,
          meanRewardDelta: null,
          baselineCalibrationError: null,
          candidateCalibrationError: null,
          calibrationErrorDelta: null,
          learningMetrics: [],
          durationSeconds: null,
          usageRecords: [],
          rejectedAt: null,
          rejectedReason: null,
          rejectedByMembershipId: null,
          createdAt: new Date("2026-11-18T12:04:00Z"),
          trainingJob: {
            startedAt: new Date("2026-11-18T12:04:00Z"),
            finishedAt: null,
          },
        },
      ],
      promotion: {
        candidateId,
        candidate: { runtimeCandidateId: "runtime-candidate-2" },
        previousCandidate: { runtimeCandidateId: "runtime-candidate-1", rejectedAt: null },
        previousCandidateId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        runtimeGeneration: 3n,
        operation: "PROMOTE",
        createdAt: new Date("2026-11-18T12:10:00Z"),
      },
      promotions: [
        {
          candidateId,
          candidate: { runtimeCandidateId: "runtime-candidate-2" },
          previousCandidate: { runtimeCandidateId: "runtime-candidate-1" },
          previousCandidateId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          runtimeGeneration: 3n,
          operation: "PROMOTE",
          createdAt: new Date("2026-11-18T12:10:00Z"),
        },
      ],
      evaluations: [
        {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          buildId: "99999999-9999-4999-8999-999999999999",
          build: { number: 42, prototypeId: "77777777-7777-4777-8777-777777777777" },
          candidateId,
          candidate: { runtimeCandidateId: "runtime-candidate-2" },
          promotionGeneration: 3n,
          summary: {
            findings: [
              {
                learning: {
                  id: "learning-gain",
                  text: "Use the compact navigation on settings pages.",
                },
                route: "/settings/profile",
                views: [{ viewport: "desktop", theme: "dark" }],
                followsProbability: 0.82,
                breaksProbability: 0.18,
              },
            ],
          },
          createdAt: new Date("2026-11-18T12:15:00Z"),
        },
      ],
    })
    const routeDependencies = createDecisionModelRouteDependencies({
      applicationOrigin: "http://127.0.0.1:5173",
      baseUrl: "https://runtime.example.test",
      credentialProvider: {
        configurationDigest: "configuration-digest",
        key: "runtime",
        getCredential: vi.fn(),
      },
      currentSession: dependencies("ADMINISTRATOR").currentSession,
      databaseUrl: "postgresql://unused",
      logger: { child: () => ({}) } as never,
      tasksetSource: {
        preflight: vi.fn().mockResolvedValue({
          counts: { prototypes: 2, builds: 5, screenshots: 11, questions: 7, samples: 43 },
          warnings: [],
        }),
        exportTrainingEvidence: vi.fn(),
        readBuildArtifacts: vi.fn(),
        createTaskset: vi.fn(),
      },
      prepareBuildEvaluation: vi.fn(),
    })

    await expect(
      routeDependencies.getOverview({ repositoryId, actorMembershipId: membershipId }),
    ).resolves.toMatchObject({
      candidates: [
        {
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
        },
        { durationSeconds: null, usage: [] },
      ],
      promotion: { generation: 3, rollbackAvailable: true },
      promotionHistory: [
        {
          generation: 3,
          runtimeCandidateId: "runtime-candidate-2",
          previousRuntimeCandidateId: "runtime-candidate-1",
          createdAt: "2026-11-18T12:10:00.000Z",
        },
      ],
      evaluations: [
        {
          model: {
            runtimeCandidateId: "runtime-candidate-2",
            generation: 3,
          },
          findings: [
            {
              learning: {
                id: "learning-gain",
                text: "Use the compact navigation on settings pages.",
              },
              route: "/settings/profile",
              views: [{ viewport: "desktop", theme: "dark" }],
            },
          ],
          createdAt: "2026-11-18T12:15:00.000Z",
        },
      ],
    })
  })

  it("passes a bounded rejection reason to the persisted candidate contract", async () => {
    const rejectCandidate = vi.fn().mockResolvedValue({
      id: candidateId,
      rejectedAt: "2026-11-18T12:05:00.000Z",
    })
    const deps = { ...dependencies("ADMINISTRATOR"), rejectCandidate }

    await withApp(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/repositories/${repositoryId}/decision-model/candidates/${candidateId}/rejection`,
        {
          method: "POST",
          headers: {
            cookie: "hub_session=current-session",
            "content-type": "application/json",
            origin: "http://127.0.0.1:5173",
          },
          body: JSON.stringify({ reason: "Held-out reward regressed." }),
        },
      )

      expect(response.status).toBe(200)
      expect(rejectCandidate).toHaveBeenCalledWith({
        repositoryId,
        actorMembershipId: membershipId,
        candidateId,
        reason: "Held-out reward regressed.",
      })
    })
  })
})
