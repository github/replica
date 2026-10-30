export interface BoundedRateLimiter {
  take(key: string, now: Date): boolean
}

export function createBoundedRateLimiter(input: {
  limit: number
  maxKeys: number
  windowMs: number
}): BoundedRateLimiter {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    !Number.isInteger(input.maxKeys) ||
    input.maxKeys < 1 ||
    !Number.isInteger(input.windowMs) ||
    input.windowMs < 1
  ) {
    throw new Error("Rate limiter bounds must be positive integers.")
  }
  const entries = new Map<string, number[]>()

  return {
    take(key, now) {
      const cutoff = now.getTime() - input.windowMs
      const recent = (entries.get(key) ?? []).filter((timestamp) => timestamp > cutoff)
      if (recent.length >= input.limit) {
        entries.delete(key)
        entries.set(key, recent)
        return false
      }
      recent.push(now.getTime())
      entries.delete(key)
      entries.set(key, recent)
      while (entries.size > input.maxKeys) entries.delete(entries.keys().next().value!)
      return true
    },
  }
}
