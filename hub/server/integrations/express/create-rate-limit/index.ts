import type { NextFunction, Request, Response } from "express"

import { IdentityError } from "#server/utils/identity-error"

export function createRateLimit({
  limit,
  windowMilliseconds,
  maxEntries = 10_000,
}: {
  limit: number
  windowMilliseconds: number
  maxEntries?: number
}) {
  const entries = new Map<string, { count: number; resetAt: number }>()

  return function rateLimit(request: Request, _response: Response, next: NextFunction) {
    const now = Date.now()
    const key = request.ip || request.socket.remoteAddress || "unknown"
    for (const [entryKey, value] of entries) {
      if (value.resetAt <= now) entries.delete(entryKey)
    }
    if (!entries.has(key) && entries.size >= maxEntries) {
      const oldestKey = entries.keys().next().value
      if (oldestKey) entries.delete(oldestKey)
    }
    const current = entries.get(key)
    const entry =
      !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMilliseconds } : current
    entry.count++
    entries.set(key, entry)
    if (entry.count > limit) {
      next(
        new IdentityError(
          429,
          "rate_limited",
          "Too many sign-in attempts. Wait five minutes and try again.",
        ),
      )
      return
    }
    next()
  }
}
