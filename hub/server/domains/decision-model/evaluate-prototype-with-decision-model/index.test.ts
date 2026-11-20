import { describe, expect, it, vi } from "vitest"

import type { AgentEvaluationDependencies, AgentEvaluationScreenshot } from "../types"
import { evaluatePrototypeWithDecisionModel } from "."

const repositoryId = "11111111-1111-4111-8111-111111111111"
const candidateId = "22222222-2222-4222-8222-222222222222"
const authority = {
  sessionKey: "session-1",
  actorMembershipId: "55555555-5555-4555-8555-555555555555",
  repositoryId,
  prototypeId: "33333333-3333-4333-8333-333333333333",
  buildId: "44444444-4444-4444-8444-444444444444",
  branch: "prototype/visual-critic",
  commitSha: "a".repeat(40),
}

function png(width: number, height: number) {
  const bytes = Buffer.alloc(36)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).copy(bytes, 24)
  return bytes.toString("base64")
}

function screenshot(overrides: Partial<AgentEvaluationScreenshot> = {}): AgentEvaluationScreenshot {
  return {
    route: "/settings",
    viewport: "desktop",
    theme: "dark",
    dataBase64: png(1_440, 900),
    ...overrides,
  }
}

function dependencies(overrides: Partial<AgentEvaluationDependencies> = {}) {
  const promotion = {
    candidateId,
    runtimeCandidateId: "runtime-candidate-7",
    previousCandidateId: null,
    previousRuntimeCandidateId: null,
    runtimeGeneration: 7,
  }
  const cache = new Map<
    string,
    { id: string; result?: Awaited<ReturnType<typeof evaluatePrototypeWithDecisionModel>> }
  >()
  const reserve = vi.fn((input: { cacheKey: string }) => {
    const current = cache.get(input.cacheKey)
    if (current?.result) {
      return Promise.resolve({ status: "cached" as const, result: current.result })
    }
    const id = "evaluation-reservation"
    cache.set(input.cacheKey, { id })
    return Promise.resolve({ status: "reserved" as const, id })
  })
  const runtimeEvaluate = vi
    .fn<AgentEvaluationDependencies["runtime"]["evaluate"]>()
    .mockResolvedValue({
      candidateId: promotion.runtimeCandidateId,
      generation: promotion.runtimeGeneration,
      responseDigest: `sha256:${"c".repeat(64)}`,
      evaluations: [
        {
          learningId: "learning-visible-label",
          followsProbability: 0.8,
          breaksProbability: 0.2,
        },
      ],
    })
  const base: AgentEvaluationDependencies = {
    cache: {
      reserve,
      complete(id, result) {
        const entry = [...cache.entries()].find(([, value]) => value.id === id)
        if (entry) cache.set(entry[0], { id, result })
        return Promise.resolve()
      },
      fail(id) {
        const entry = [...cache.entries()].find(([, value]) => value.id === id)
        if (entry) cache.delete(entry[0])
        return Promise.resolve()
      },
    },
    limits: {
      checkRate: vi.fn().mockResolvedValue(undefined),
    },
    readLearningAuthority: vi.fn().mockResolvedValue({
      consentGranted: true,
      questionDigest: `sha256:${"b".repeat(64)}`,
      questions: {
        "learning-visible-label": {
          learning_text: "Keep a visible label beside every form field.",
        },
      },
    }),
    readRuntimeReadiness: vi.fn().mockResolvedValue({
      ready: true,
      environment: "production",
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
      evaluate: runtimeEvaluate,
    },
    store: {
      getConfiguration: vi.fn().mockResolvedValue({
        enabled: true,
        backend: "customer-runtime",
        maxUpdates: 100,
        maxSeconds: 300,
        monthlyBudgetCredits: "500",
        generation: 4,
      }),
      getCandidate: vi.fn().mockResolvedValue({
        id: candidateId,
        repositoryId,
        runtimeCandidateId: promotion.runtimeCandidateId,
        tasksetDigest: `sha256:${"d".repeat(64)}`,
        rejectedAt: null,
        productionEligible: true,
      }),
      getPromotion: vi.fn().mockResolvedValue(promotion),
    },
  }
  return { ...base, ...overrides, runtimeEvaluate, reserve }
}

describe("evaluatePrototypeWithDecisionModel()", () => {
  it("returns structured unverified guidance from the production promotion", async () => {
    const deps = dependencies()

    const result = await evaluatePrototypeWithDecisionModel(
      {
        authority,
        currentRoute: "/settings",
        screenshots: [
          screenshot(),
          screenshot({
            viewport: "narrow",
            theme: "light",
            dataBase64: png(390, 844),
          }),
        ],
      },
      deps,
    )

    expect(result).toMatchObject({
      status: "fresh",
      environment: "production",
      guidance: {
        available: true,
      },
      context: {
        repositoryId,
        prototypeId: authority.prototypeId,
        buildId: authority.buildId,
        branch: authority.branch,
        commitSha: authority.commitSha,
      },
      model: {
        candidateId,
        runtimeCandidateId: "runtime-candidate-7",
        promotionGeneration: 7,
      },
      findings: [
        {
          learning: {
            id: "learning-visible-label",
            text: "Keep a visible label beside every form field.",
          },
          route: "/settings",
          views: [
            { viewport: "desktop", theme: "dark" },
            { viewport: "narrow", theme: "light" },
          ],
          followsProbability: 0.8,
          breaksProbability: 0.2,
        },
      ],
    })
    expect(result.guidance.notice).toMatch(/unverified authoring guidance/i)
    expect(result.findings[0]?.explanation).toMatch(/unverified authoring guidance/i)
    const runtimeInput = deps.runtimeEvaluate.mock.calls[0]?.[0]
    expect(runtimeInput?.state).toMatchObject({
      route: "/settings",
      branch: authority.branch,
      commitSha: authority.commitSha,
    })
    expect(runtimeInput?.images).toHaveLength(2)
    expect(runtimeInput?.images[0]).toMatch(/^data:image\/png;base64,/)
    expect(runtimeInput?.questions).toHaveProperty("learning-visible-label")
  })

  it("reuses a matching cache entry without a second runtime call or fresh reservation", async () => {
    const deps = dependencies()
    const input = {
      authority,
      currentRoute: "/settings",
      screenshots: [screenshot()],
    }

    const first = await evaluatePrototypeWithDecisionModel(input, deps)
    const second = await evaluatePrototypeWithDecisionModel(input, deps)

    expect(first.status).toBe("fresh")
    expect(second).toMatchObject({ evaluationId: first.evaluationId, status: "cached" })
    expect(deps.runtimeEvaluate).toHaveBeenCalledTimes(1)
    expect(deps.reserve).toHaveBeenCalledTimes(2)
  })

  it("marks fixture findings as unavailable test data", async () => {
    const deps = dependencies({
      readRuntimeReadiness: vi.fn().mockResolvedValue({
        ready: true,
        environment: "fixture",
      }),
    })

    const result = await evaluatePrototypeWithDecisionModel(
      { authority, currentRoute: null, screenshots: [screenshot()] },
      deps,
    )

    expect(result.guidance.available).toBe(false)
    expect(result.guidance.notice).toMatch(/fixture findings are test data/i)
    expect(result.findings[0]?.explanation).toMatch(/^Fixture only\./)
  })

  it("rejects evaluation when repository learning consent is absent", async () => {
    const deps = dependencies({
      readLearningAuthority: vi.fn().mockResolvedValue({
        consentGranted: false,
        questionDigest: `sha256:${"b".repeat(64)}`,
        questions: {},
      }),
    })

    await expect(
      evaluatePrototypeWithDecisionModel(
        { authority, currentRoute: null, screenshots: [screenshot()] },
        deps,
      ),
    ).rejects.toMatchObject({ status: 409, code: "consent_required" })
    expect(deps.runtimeEvaluate).not.toHaveBeenCalled()
  })

  it("rejects a non-production candidate in a production runtime", async () => {
    const deps = dependencies({
      store: {
        ...dependencies().store,
        getCandidate: vi.fn().mockResolvedValue({
          id: candidateId,
          repositoryId,
          runtimeCandidateId: "runtime-candidate-7",
          tasksetDigest: `sha256:${"d".repeat(64)}`,
          rejectedAt: null,
          productionEligible: false,
        }),
      },
    })

    await expect(
      evaluatePrototypeWithDecisionModel(
        { authority, currentRoute: null, screenshots: [screenshot()] },
        deps,
      ),
    ).rejects.toMatchObject({ status: 409, code: "learning_ineligible" })
    expect(deps.runtimeEvaluate).not.toHaveBeenCalled()
  })

  it("rejects findings when the promotion changes after runtime evaluation", async () => {
    const base = dependencies()
    const initialPromotion = await base.store.getPromotion(repositoryId)
    const getPromotion = vi
      .fn()
      .mockResolvedValueOnce(initialPromotion)
      .mockResolvedValueOnce({
        ...initialPromotion,
        candidateId: "55555555-5555-4555-8555-555555555555",
        runtimeGeneration: 8,
      })
    const deps = dependencies({
      store: { ...base.store, getPromotion },
    })

    await expect(
      evaluatePrototypeWithDecisionModel(
        { authority, currentRoute: null, screenshots: [screenshot()] },
        deps,
      ),
    ).rejects.toMatchObject({ status: 409, code: "promotion_stale" })
  })
})
