import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import type { AuthenticationRateLimitDatabase } from "./types"
import { reserveAuthenticationRateLimit } from "."

function reserve(
  keyDigest: string,
  scope: "github_callback" | "github_start" = "github_start",
  database: AuthenticationRateLimitDatabase = prisma,
) {
  return reserveAuthenticationRateLimit(database, {
    id: randomUUID(),
    keyDigest,
    limit: 10,
    scope,
    windowSeconds: 600,
  })
}

describe("reserveAuthenticationRateLimit()", () => {
  it("atomically admits exactly the configured budget under concurrency", async () => {
    const results = await Promise.all(Array.from({ length: 11 }, () => reserve("a".repeat(64))))

    expect(results.filter(Boolean)).toHaveLength(10)
    expect(results.filter((reserved) => !reserved)).toHaveLength(1)
  })

  it("isolates addresses and operation scopes", async () => {
    await Promise.all(Array.from({ length: 10 }, () => reserve("a".repeat(64))))

    await expect(reserve("b".repeat(64))).resolves.toBe(true)
    await expect(reserve("a".repeat(64), "github_callback")).resolves.toBe(true)
  })

  it("resets an expired window and deletes stale buckets", async () => {
    await reserve("a".repeat(64))
    await prisma.authenticationRateLimit.updateMany({
      data: { windowStartedAt: new Date("2000-01-01T00:00:00Z") },
    })

    await expect(reserve("a".repeat(64))).resolves.toBe(true)
    await expect(prisma.authenticationRateLimit.count()).resolves.toBe(1)
    await expect(prisma.authenticationRateLimit.findFirstOrThrow()).resolves.toMatchObject({
      reservationCount: 1,
    })
  })

  it("does not reserve capacity when its transaction rolls back", async () => {
    const rollbackDatabase: AuthenticationRateLimitDatabase = {
      $transaction(
        operation: Parameters<AuthenticationRateLimitDatabase["$transaction"]>[0],
        options: Parameters<AuthenticationRateLimitDatabase["$transaction"]>[1],
      ) {
        return prisma.$transaction(async (transaction) => {
          await operation(transaction)
          throw new Error("forced rollback")
        }, options)
      },
    }

    await expect(reserve("a".repeat(64), "github_start", rollbackDatabase)).rejects.toThrow(
      "forced rollback",
    )
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve("a".repeat(64))))
    expect(results.every(Boolean)).toBe(true)
  })
})
