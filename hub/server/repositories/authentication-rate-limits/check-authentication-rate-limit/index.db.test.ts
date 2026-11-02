import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { checkAuthenticationRateLimit } from "."

function input(subjectDigest: string, limit = 3) {
  return {
    limit,
    operation: "start",
    subjectDigest,
    windowSeconds: 60,
  }
}

describe("checkAuthenticationRateLimit()", () => {
  it("reserves capacity atomically at the exact threshold", async () => {
    const subjectDigest = "a".repeat(64)

    const sharedResults = await Promise.all(
      Array.from({ length: 10 }, () =>
        checkAuthenticationRateLimit(input(subjectDigest, 5), prisma),
      ),
    )
    expect(sharedResults.filter(Boolean)).toHaveLength(5)

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        checkAuthenticationRateLimit(input(String(index).padStart(64, "b"), 5), prisma),
      ),
    )
    expect(results).toEqual(Array(10).fill(true))

    const shared = await prisma.authenticationRateLimit.findUniqueOrThrow({
      where: {
        operation_subjectDigest: { operation: "start", subjectDigest },
      },
    })
    expect(shared.count).toBe(10)
  })

  it("resets an expired subject without using application time", async () => {
    const subjectDigest = "c".repeat(64)
    const createdAt = new Date("2020-01-01T00:00:00Z")
    await prisma.authenticationRateLimit.create({
      data: {
        id: randomUUID(),
        operation: "start",
        subjectDigest,
        windowStartedAt: createdAt,
        count: 99,
        expiresAt: new Date("2020-01-01T00:01:00Z"),
        createdAt,
        updatedAt: createdAt,
      },
    })

    await expect(checkAuthenticationRateLimit(input(subjectDigest), prisma)).resolves.toBe(true)
    await expect(
      prisma.authenticationRateLimit.findUniqueOrThrow({
        where: {
          operation_subjectDigest: { operation: "start", subjectDigest },
        },
        select: { count: true },
      }),
    ).resolves.toEqual({ count: 1 })
  })

  it("deletes at most 100 expired rows per request and progresses on later calls", async () => {
    const createdAt = new Date("2020-01-01T00:00:00Z")
    await prisma.authenticationRateLimit.createMany({
      data: Array.from({ length: 205 }, (_, index) => ({
        id: randomUUID(),
        operation: "callback",
        subjectDigest: index.toString(16).padStart(64, "0"),
        windowStartedAt: createdAt,
        count: 1,
        expiresAt: new Date("2020-01-01T00:01:00Z"),
        createdAt,
        updatedAt: createdAt,
      })),
    })

    await checkAuthenticationRateLimit(input("d".repeat(64)), prisma)
    expect(
      await prisma.authenticationRateLimit.count({
        where: { expiresAt: { lt: new Date() } },
      }),
    ).toBe(105)

    await checkAuthenticationRateLimit(input("e".repeat(64)), prisma)
    expect(
      await prisma.authenticationRateLimit.count({
        where: { expiresAt: { lt: new Date() } },
      }),
    ).toBe(5)

    await checkAuthenticationRateLimit(input("f".repeat(64)), prisma)
    expect(
      await prisma.authenticationRateLimit.count({
        where: { expiresAt: { lt: new Date() } },
      }),
    ).toBe(0)
  })
})
