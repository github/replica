import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentEvaluationDependencies } from "../../../../../domains/decision-model/types"

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  createStore: vi.fn(),
  evaluate: vi.fn(),
  fail: vi.fn(),
  reserve: vi.fn(),
  rate: vi.fn(),
}))

vi.mock("../../../../../domains/decision-model/create-decision-model-store/index.ts", () => ({
  createDecisionModelStore: mocks.createStore,
}))
vi.mock(
  "../../../../../domains/decision-model/evaluate-prototype-with-decision-model/index.ts",
  () => ({
    evaluatePrototypeWithDecisionModel: mocks.evaluate,
  }),
)
vi.mock(
  "../../../../../repositories/authentication-rate-limits/reserve-authentication-rate-limit/index.ts",
  () => ({
    reserveAuthenticationRateLimit: mocks.rate,
  }),
)
vi.mock(
  "../../../../../repositories/decision-agent-evaluations/complete-decision-agent-evaluation/index.ts",
  () => ({
    completeDecisionAgentEvaluation: mocks.complete,
  }),
)
vi.mock(
  "../../../../../repositories/decision-agent-evaluations/fail-decision-agent-evaluation/index.ts",
  () => ({
    failDecisionAgentEvaluation: mocks.fail,
  }),
)
vi.mock(
  "../../../../../repositories/decision-agent-evaluations/reserve-decision-agent-evaluation/index.ts",
  () => ({
    reserveDecisionAgentEvaluation: mocks.reserve,
  }),
)

import { createAgentVisualCriticRouteDependencies } from "."

const repositoryId = "11111111-1111-4111-8111-111111111111"
const candidateId = "22222222-2222-4222-8222-222222222222"
const authority = {
  actorMembershipId: "33333333-3333-4333-8333-333333333333",
  sessionKey: "session",
  repositoryId,
  prototypeId: null,
  buildId: null,
  branch: "prototype/example",
  commitSha: "a".repeat(40),
}
const promotion = {
  candidateId,
  runtimeCandidateId: "runtime-candidate",
  previousCandidateId: null,
  previousRuntimeCandidateId: null,
  runtimeGeneration: 3,
}

function options() {
  return {
    database: {} as never,
    runtimeEnvironment: "production" as const,
    runtimeForRepository: vi.fn().mockReturnValue({
      getPromotion: vi.fn().mockResolvedValue({
        candidateId: promotion.runtimeCandidateId,
        generation: promotion.runtimeGeneration,
      }),
    }),
    readLearningAuthority: vi.fn().mockResolvedValue({
      consentGranted: true,
      questionDigest: `sha256:${"b".repeat(64)}`,
      questions: {},
    }),
  }
}

describe("createAgentVisualCriticRouteDependencies()", () => {
  beforeEach(() => {
    mocks.rate.mockResolvedValue({ allowed: true })
    mocks.reserve.mockResolvedValue({ status: "reserved", id: "reservation" })
    mocks.complete.mockResolvedValue(undefined)
    mocks.fail.mockResolvedValue(undefined)
    mocks.createStore.mockReturnValue({
      getCandidate: vi.fn().mockResolvedValue({
        id: candidateId,
        consentGrantId: "grant",
        questionDigest: `sha256:${"b".repeat(64)}`,
      }),
      getConfiguration: vi.fn().mockResolvedValue({ enabled: true }),
      getPromotion: vi.fn().mockResolvedValue(promotion),
      isCandidateRevoked: vi.fn().mockResolvedValue(false),
    })
  })

  it("removes learning text before persisting a completed cache entry", async () => {
    mocks.evaluate.mockImplementation(
      async (_input: unknown, dependencies: AgentEvaluationDependencies) => {
        await dependencies.cache.complete("reservation", {
          evaluationId: "44444444-4444-4444-8444-444444444444",
          status: "fresh",
          environment: "production",
          guidance: { available: true, notice: "Unverified." },
          context: {
            repositoryId,
            prototypeId: null,
            buildId: null,
            branch: authority.branch,
            commitSha: authority.commitSha,
          },
          model: {
            candidateId,
            runtimeCandidateId: promotion.runtimeCandidateId,
            promotionGeneration: promotion.runtimeGeneration,
          },
          screenshotSetDigest: `sha256:${"c".repeat(64)}`,
          findings: [
            {
              learning: { id: "learning-1", text: "Private accepted learning text." },
              route: "/",
              views: [{ viewport: "desktop", theme: "light" }],
              followsProbability: 0.8,
              breaksProbability: 0.2,
              explanation: "Unverified.",
            },
          ],
        })
        return {} as never
      },
    )
    const dependencies = createAgentVisualCriticRouteDependencies(options())

    await dependencies.evaluate({ authority, currentRoute: "/", screenshots: [] })

    expect(JSON.stringify(mocks.complete.mock.calls)).not.toContain(
      "Private accepted learning text.",
    )
    expect(JSON.stringify(mocks.complete.mock.calls)).toContain(
      '"learning":{"id":"learning-1","text":null}',
    )
  })

  it("requires the candidate's pinned question digest and matching runtime promotion", async () => {
    mocks.evaluate.mockImplementation(
      async (_input: unknown, dependencies: AgentEvaluationDependencies) => {
        await expect(
          dependencies.readLearningAuthority({
            repositoryId,
            candidateId,
            promotionGeneration: 3,
          }),
        ).resolves.toMatchObject({ questionDigest: `sha256:${"b".repeat(64)}` })
        await expect(dependencies.readRuntimeReadiness({ repositoryId })).resolves.toEqual({
          ready: true,
          environment: "production",
        })
        return {} as never
      },
    )
    const configured = options()
    const dependencies = createAgentVisualCriticRouteDependencies(configured)

    await dependencies.evaluate({ authority, currentRoute: "/", screenshots: [] })

    configured.readLearningAuthority.mockResolvedValueOnce({
      consentGranted: true,
      questionDigest: `sha256:${"d".repeat(64)}`,
      questions: {},
    })
    mocks.evaluate.mockImplementationOnce(
      (_input: unknown, dependencies: AgentEvaluationDependencies) =>
        dependencies.readLearningAuthority({
          repositoryId,
          candidateId,
          promotionGeneration: 3,
        }),
    )
    await expect(
      dependencies.evaluate({ authority, currentRoute: "/", screenshots: [] }),
    ).rejects.toMatchObject({ code: "configuration_stale" })

    configured.runtimeForRepository.mockReturnValueOnce({
      getPromotion: vi.fn().mockResolvedValue({ candidateId: null, generation: 4 }),
    })
    const mismatched = createAgentVisualCriticRouteDependencies(configured)
    mocks.evaluate.mockImplementationOnce(
      (_input: unknown, dependencies: AgentEvaluationDependencies) =>
        dependencies.readRuntimeReadiness({ repositoryId }),
    )
    await expect(
      mismatched.evaluate({ authority, currentRoute: "/", screenshots: [] }),
    ).resolves.toEqual({ ready: false, environment: "production" })
  })
})
