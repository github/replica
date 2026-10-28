import type { NextFunction, Request, Response } from "express"

import { AuthenticationError } from "#server/utils/authentication-error"

export function createRateLimit({
  limit,
  windowMilliseconds,
  maxEntries = 10_000,
  message = "Too many authentication requests.",
}: {
  limit: number
  windowMilliseconds: number
  maxEntries?: number
  message?: string
}) {
  const entries = new Map<string, { count: number; resetAt: number }>()

  return function rateLimit(request: Request, _response: Response, next: NextFunction): void {
    const now = Date.now()
    const key = request.ip || request.socket.remoteAddress || "unknown"
    for (const [entryKey, value] of entries) {
      if (value.resetAt <= now) entries.delete(entryKey)
    }
    if (!entries.has(key) && entries.size >= maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest) entries.delete(oldest)
    }
    const current = entries.get(key)
    const entry =
      !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMilliseconds } : current
    entry.count++
    entries.set(key, entry)
    if (entry.count > limit) {
      next(new AuthenticationError(429, "rate_limited", message))
      return
    }
    next()
  }
}
