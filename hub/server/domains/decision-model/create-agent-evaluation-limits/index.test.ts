import { describe, expect, it } from "vitest"

import { createAgentEvaluationLimits } from "."

const firstRepository = "11111111-1111-4111-8111-111111111111"
const secondRepository = "22222222-2222-4222-8222-222222222222"

describe("createAgentEvaluationLimits()", () => {
  it("enforces the per-session request window across repositories", async () => {
    const counts = new Map<string, number>()
    const limits = createAgentEvaluationLimits({
      reserve: ({ limit, operation, subject }) => {
        const key = `${operation}:${subject}`
        const count = (counts.get(key) ?? 0) + 1
        counts.set(key, count)
        return Promise.resolve(count <= limit)
      },
      sessionRequestsPerMinute: 1,
      repositoryRequestsPerMinute: 10,
    })

    await limits.checkRate({ sessionKey: "session-1", repositoryId: firstRepository })

    await expect(
      limits.checkRate({ sessionKey: "session-1", repositoryId: secondRepository }),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" })
  })

  it("enforces the repository request window across sessions", async () => {
    const counts = new Map<string, number>()
    const limits = createAgentEvaluationLimits({
      reserve: ({ limit, operation, subject }) => {
        const key = `${operation}:${subject}`
        const count = (counts.get(key) ?? 0) + 1
        counts.set(key, count)
        return Promise.resolve(count <= limit)
      },
      sessionRequestsPerMinute: 10,
      repositoryRequestsPerMinute: 1,
    })

    await limits.checkRate({ sessionKey: "session-1", repositoryId: firstRepository })

    await expect(
      limits.checkRate({ sessionKey: "session-2", repositoryId: firstRepository }),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" })
  })
})
