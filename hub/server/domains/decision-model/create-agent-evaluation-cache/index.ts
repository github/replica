import type { AgentEvaluationCache, AgentEvaluationResult } from "../types.ts"

export function createAgentEvaluationCache({
  maxEntries = 128,
  ttlMs = 15 * 60 * 1_000,
  now = () => Date.now(),
}: {
  maxEntries?: number
  ttlMs?: number
  now?: () => number
} = {}): AgentEvaluationCache {
  const entries = new Map<string, { expiresAt: number; value: AgentEvaluationResult }>()

  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return null
      if (entry.expiresAt <= now()) {
        entries.delete(key)
        return null
      }
      entries.delete(key)
      entries.set(key, entry)
      return structuredClone(entry.value)
    },
    set(key, value) {
      entries.delete(key)
      entries.set(key, { expiresAt: now() + ttlMs, value: structuredClone(value) })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        if (typeof oldest !== "string") break
        entries.delete(oldest)
      }
    },
  }
}
