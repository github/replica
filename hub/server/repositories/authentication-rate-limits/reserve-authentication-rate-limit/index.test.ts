import { describe, expect, it, vi } from "vitest"

import { reserveAuthenticationRateLimit } from "."
import type { AuthenticationRateLimitDatabase } from "./types"

function queryText(strings: TemplateStringsArray) {
  return strings.join("?").replace(/\s+/g, " ").trim()
}

describe("reserveAuthenticationRateLimit()", () => {
  it("creates, resets, or increments the request bucket with one atomic upsert before cleanup", async () => {
    const calls: string[] = []
    const database: AuthenticationRateLimitDatabase = {
      $queryRaw<Result>(strings: TemplateStringsArray) {
        calls.push(queryText(strings))
        return Promise.resolve([{ allowed: true, auditRequired: false }] as Result)
      },
      $executeRaw: vi.fn((strings: TemplateStringsArray) => {
        calls.push(queryText(strings))
        return Promise.resolve(0)
      }),
    }

    await reserveAuthenticationRateLimit(database, {
      auditFirstDenial: false,
      limit: 3,
      operation: "start",
      subjectDigest: "a".repeat(64),
      windowSeconds: 60,
    })

    expect(calls[0]).toContain("INSERT INTO")
    expect(calls[0]).toContain("ON CONFLICT")
    expect(calls[0]).toContain("DO UPDATE")
    expect(calls[0]).toContain("RETURNING")
    expect(calls[1]).toContain("DELETE FROM")
    expect(calls).toHaveLength(2)
  })

  it("returns the exact threshold and first-denial decisions from the atomic reservation", async () => {
    const database: AuthenticationRateLimitDatabase = {
      $queryRaw<Result>() {
        return Promise.resolve([{ allowed: false, auditRequired: true }] as Result)
      },
      $executeRaw: vi.fn().mockResolvedValue(0),
    }

    await expect(
      reserveAuthenticationRateLimit(database, {
        auditFirstDenial: false,
        limit: 3,
        operation: "callback",
        subjectDigest: "b".repeat(64),
        windowSeconds: 60,
      }),
    ).resolves.toEqual({ allowed: false, auditRequired: true })
  })
})
