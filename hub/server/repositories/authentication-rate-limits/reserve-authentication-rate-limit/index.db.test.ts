import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { reserveAuthenticationRateLimit } from "."

function reserve(
  keyDigest: string,
  scope: "github_callback" | "github_start" = "github_start",
  database = prisma,
) {
  return database.$transaction((transaction) =>
    reserveAuthenticationRateLimit(transaction, {
      id: randomUUID(),
      keyDigest,
      limit: 10,
      scope,
      windowSeconds: 600,
    }),
  )
}

describe("reserveAuthenticationRateLimit()", () => {
  it("atomically admits exactly the configured budget under concurrency", async () => {
    const results = await Promise.all(Array.from({ length: 11 }, () => reserve("a".repeat(64))))

    expect(results.filter(({ reserved }) => reserved)).toHaveLength(10)
    expect(results.filter(({ reserved }) => !reserved)).toHaveLength(1)
    expect(results.filter(({ shouldAuditDenial }) => shouldAuditDenial)).toHaveLength(1)
  })

  it("isolates addresses and operation scopes", async () => {
    await Promise.all(Array.from({ length: 10 }, () => reserve("a".repeat(64))))

    await expect(reserve("b".repeat(64))).resolves.toMatchObject({ reserved: true })
    await expect(reserve("a".repeat(64), "github_callback")).resolves.toMatchObject({
      reserved: true,
    })
  })

  it("resets an expired window and deletes stale buckets", async () => {
    await reserve("a".repeat(64))
    await prisma.authenticationRateLimit.updateMany({
      data: { windowStartedAt: new Date("2000-01-01T00:00:00Z") },
    })

    await expect(reserve("a".repeat(64))).resolves.toMatchObject({
      reserved: true,
      shouldAuditDenial: false,
    })
    await expect(prisma.authenticationRateLimit.count()).resolves.toBe(1)
    await expect(prisma.authenticationRateLimit.findFirstOrThrow()).resolves.toMatchObject({
      reservationCount: 1,
    })
  })

  it("does not reserve capacity when its transaction rolls back", async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        await reserveAuthenticationRateLimit(transaction, {
          id: randomUUID(),
          keyDigest: "a".repeat(64),
          limit: 10,
          scope: "github_start",
          windowSeconds: 600,
        })
        throw new Error("forced rollback")
      }),
    ).rejects.toThrow("forced rollback")
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve("a".repeat(64))))
    expect(results.every(({ reserved }) => reserved)).toBe(true)
  })

  it("keeps cleanup eligible for the window-start index", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'authentication_rate_limits'
    `
    expect(indexes.map(({ indexname }) => indexname)).toContain(
      "authentication_rate_limits_window_started_at_idx",
    )
  })
})
