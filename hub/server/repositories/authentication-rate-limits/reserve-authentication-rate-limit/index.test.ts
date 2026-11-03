import { describe, expect, it, vi } from "vitest"

import { reserveAuthenticationRateLimit } from "."
import type { AuthenticationRateLimitDatabase } from "./types"

function queryText(strings: TemplateStringsArray) {
  return strings.join("?").replace(/\s+/g, " ").trim()
}

describe("reserveAuthenticationRateLimit()", () => {
  it("locks an existing request bucket before cleaning unrelated expired buckets", async () => {
    const calls: string[] = []
    const queryResults: unknown[] = [
      [],
      [
        {
          count: 1,
          denialAuditedAt: null,
          expired: false,
          id: "00000000-0000-0000-0000-000000000001",
        },
      ],
    ]
    const database: AuthenticationRateLimitDatabase = {
      $queryRaw<Result>(strings: TemplateStringsArray) {
        calls.push(queryText(strings))
        return Promise.resolve(queryResults.shift() as Result)
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
    expect(calls[1]).toContain("FOR UPDATE")
    expect(calls[2]).toContain("DELETE FROM")
  })

  it("recreates a bucket that cleanup removed after an insert conflict", async () => {
    const calls: string[] = []
    const queryResults: unknown[] = [[], [], [{ id: "new-bucket" }]]
    const database: AuthenticationRateLimitDatabase = {
      $queryRaw<Result>(strings: TemplateStringsArray) {
        calls.push(queryText(strings))
        return Promise.resolve(queryResults.shift() as Result)
      },
      $executeRaw: vi.fn((strings: TemplateStringsArray) => {
        calls.push(queryText(strings))
        return Promise.resolve(0)
      }),
    }

    await expect(
      reserveAuthenticationRateLimit(database, {
        auditFirstDenial: false,
        limit: 3,
        operation: "callback",
        subjectDigest: "b".repeat(64),
        windowSeconds: 60,
      }),
    ).resolves.toEqual({ allowed: true, auditRequired: false })
    expect(calls.filter((call) => call.includes("INSERT INTO"))).toHaveLength(2)
    expect(calls.at(-1)).toContain("DELETE FROM")
  })
})
