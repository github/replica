import { describe, expect, it } from "vitest"

import { createAgentEvaluationLimits } from "."

const firstRepository = "11111111-1111-4111-8111-111111111111"
const secondRepository = "22222222-2222-4222-8222-222222222222"

describe("createAgentEvaluationLimits()", () => {
  it("enforces the per-session request window across repositories", () => {
    const limits = createAgentEvaluationLimits({
      sessionRequestsPerMinute: 1,
      repositoryRequestsPerMinute: 10,
    })

    limits.checkRate({ sessionKey: "session-1", repositoryId: firstRepository })

    expect(() =>
      limits.checkRate({ sessionKey: "session-1", repositoryId: secondRepository }),
    ).toThrow(expect.objectContaining({ status: 429, code: "rate_limited" }))
  })

  it("enforces the repository request window across sessions", () => {
    const limits = createAgentEvaluationLimits({
      sessionRequestsPerMinute: 10,
      repositoryRequestsPerMinute: 1,
    })

    limits.checkRate({ sessionKey: "session-1", repositoryId: firstRepository })

    expect(() =>
      limits.checkRate({ sessionKey: "session-2", repositoryId: firstRepository }),
    ).toThrow(expect.objectContaining({ status: 429, code: "rate_limited" }))
  })

  it("charges fresh route work against the repository monthly budget and resets next month", () => {
    let current = new Date("2026-11-30T23:59:00Z")
    const limits = createAgentEvaluationLimits({
      now: () => current,
      repositoryMonthlyCredits: 2,
    })

    limits.reserveFresh({ repositoryId: firstRepository, credits: 2 })
    expect(() => limits.reserveFresh({ repositoryId: firstRepository, credits: 1 })).toThrow(
      expect.objectContaining({ status: 409, code: "budget_exceeded" }),
    )

    current = new Date("2026-12-01T00:00:00Z")
    expect(() => limits.reserveFresh({ repositoryId: firstRepository, credits: 2 })).not.toThrow()
  })
})
