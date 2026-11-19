import { DecisionModelError } from "../errors.ts"
import type { AgentEvaluationLimits } from "../types.ts"

type Window = { startedAt: number; count: number }
type Budget = { month: string; credits: number }

export function createAgentEvaluationLimits({
  now = () => new Date(),
  maxTrackedKeys = 1_000,
  repositoryMonthlyCredits = 500,
  repositoryRequestsPerMinute = 30,
  sessionRequestsPerMinute = 6,
}: {
  now?: () => Date
  maxTrackedKeys?: number
  repositoryMonthlyCredits?: number
  repositoryRequestsPerMinute?: number
  sessionRequestsPerMinute?: number
} = {}): AgentEvaluationLimits {
  const sessions = new Map<string, Window>()
  const repositories = new Map<string, Window>()
  const budgets = new Map<string, Budget>()

  function consumeWindow(key: string, limit: number, windows: Map<string, Window>) {
    const timestamp = now().getTime()
    for (const [trackedKey, tracked] of windows) {
      if (timestamp - tracked.startedAt >= 60_000) windows.delete(trackedKey)
    }
    const current = windows.get(key)
    if (!current && windows.size >= maxTrackedKeys) {
      throw new DecisionModelError(
        429,
        "rate_limited",
        "Prototype evaluation is temporarily rate limited.",
      )
    }
    const window =
      current && timestamp - current.startedAt < 60_000
        ? current
        : { startedAt: timestamp, count: 0 }
    if (window.count >= limit) {
      throw new DecisionModelError(
        429,
        "rate_limited",
        "Prototype evaluation is temporarily rate limited.",
      )
    }
    window.count += 1
    windows.set(key, window)
  }

  return {
    checkRate({ sessionKey, repositoryId }) {
      consumeWindow(sessionKey, sessionRequestsPerMinute, sessions)
      consumeWindow(repositoryId, repositoryRequestsPerMinute, repositories)
    },
    reserveFresh({ repositoryId, credits }) {
      const date = now()
      const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
      const current = budgets.get(repositoryId)
      if (!current && budgets.size >= maxTrackedKeys) {
        throw new DecisionModelError(
          409,
          "budget_exceeded",
          "The repository prototype-evaluation budget cannot accept more repositories.",
        )
      }
      const budget = current?.month === month ? current : { month, credits: 0 }
      if (budget.credits + credits > repositoryMonthlyCredits) {
        throw new DecisionModelError(
          409,
          "budget_exceeded",
          "The repository prototype-evaluation budget has been reached.",
        )
      }
      budget.credits += credits
      budgets.set(repositoryId, budget)
    },
  }
}
