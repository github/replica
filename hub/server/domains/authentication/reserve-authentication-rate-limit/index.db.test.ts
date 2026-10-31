import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { reserveAuthenticationRateLimit } from "."

async function fillBudget(requestIp = "192.0.2.10") {
  return Promise.all(
    Array.from({ length: 10 }, () =>
      reserveAuthenticationRateLimit(prisma, {
        operation: "start",
        provider: "github",
        requestIp,
      }),
    ),
  )
}

describe("reserveAuthenticationRateLimit()", () => {
  it("rolls back the audit marker when the typed audit insert fails", async () => {
    await fillBudget()
    const auditFailure = new Error("audit unavailable")
    await expect(
      reserveAuthenticationRateLimit(
        prisma,
        { operation: "start", provider: "github", requestIp: "192.0.2.10" },
        { createAudit: () => Promise.reject(auditFailure) },
      ),
    ).rejects.toBeInstanceOf(AggregateError)
    await expect(prisma.authenticationRateLimit.findFirstOrThrow()).resolves.toMatchObject({
      denialAuditedAt: null,
    })

    await expect(
      reserveAuthenticationRateLimit(prisma, {
        operation: "start",
        provider: "github",
        requestIp: "192.0.2.10",
      }),
    ).resolves.toEqual({ reserved: false })
    await expect(
      prisma.securityAudit.count({ where: { action: "authentication.attempt.denied" } }),
    ).resolves.toBe(1)
  })

  it("creates exactly one denial audit across concurrent clients and none for repeats", async () => {
    await fillBudget()
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveAuthenticationRateLimit(prisma, {
          operation: "start",
          provider: "github",
          requestIp: "192.0.2.10",
        }),
      ),
    )
    expect(results.every(({ reserved }) => !reserved)).toBe(true)
    await expect(
      prisma.securityAudit.count({ where: { action: "authentication.attempt.denied" } }),
    ).resolves.toBe(1)

    await reserveAuthenticationRateLimit(prisma, {
      operation: "start",
      provider: "github",
      requestIp: "192.0.2.10",
    })
    await expect(
      prisma.securityAudit.count({ where: { action: "authentication.attempt.denied" } }),
    ).resolves.toBe(1)
  })

  it("clears the marker with a new window and audits the next denial once", async () => {
    await fillBudget()
    await reserveAuthenticationRateLimit(prisma, {
      operation: "start",
      provider: "github",
      requestIp: "192.0.2.10",
    })
    await prisma.authenticationRateLimit.updateMany({
      data: { windowStartedAt: new Date("2000-01-01T00:00:00Z") },
    })
    const reset = await fillBudget()
    expect(reset.every(({ reserved }) => reserved)).toBe(true)
    await reserveAuthenticationRateLimit(prisma, {
      operation: "start",
      provider: "github",
      requestIp: "192.0.2.10",
    })
    await expect(
      prisma.securityAudit.count({ where: { action: "authentication.attempt.denied" } }),
    ).resolves.toBe(2)
  })

  it("never stores the raw request address", async () => {
    await fillBudget("203.0.113.44")
    await reserveAuthenticationRateLimit(prisma, {
      operation: "start",
      provider: "github",
      requestIp: "203.0.113.44",
    })
    const bucket = await prisma.authenticationRateLimit.findFirstOrThrow()
    const audits = await prisma.securityAudit.findMany()
    expect(bucket.keyDigest).not.toContain("203.0.113.44")
    expect(JSON.stringify(audits)).not.toContain("203.0.113.44")
  })
})
