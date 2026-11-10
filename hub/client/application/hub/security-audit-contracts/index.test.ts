import { describe, expect, it } from "vitest"

import { securityAuditResponseSchema } from "."

const record = {
  id: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-11-10T12:00:00.000Z",
  action: "identity.provider_revision.selected",
  outcome: "success",
  actor: { membershipId: "22222222-2222-4222-8222-222222222222" },
  context: {
    provider: "github",
    revision: 3,
    providerKeys: ["github", "entra"],
  },
}

describe("securityAuditResponseSchema", () => {
  it("accepts provider-neutral UUID records and a nullable opaque cursor", () => {
    expect(
      securityAuditResponseSchema.parse({
        records: [record],
        nextCursor: "opaque+/cursor==",
      }),
    ).toEqual({
      records: [record],
      nextCursor: "opaque+/cursor==",
    })
  })

  it.each([
    ["a nested object", { metadata: { provider: "github" } }],
    ["a non-integer number", { revision: 1.5 }],
    ["a mixed array", { providerKeys: ["github", 2] }],
    ["a secret-bearing field", { accessToken: "github_pat_1234567890abcdef" }],
    ["credential-shaped text", { reason: "Bearer private-credential-value" }],
  ])("rejects context containing %s", (_label, context) => {
    expect(
      securityAuditResponseSchema.safeParse({
        records: [{ ...record, context }],
        nextCursor: null,
      }).success,
    ).toBe(false)
  })

  it("rejects malformed record identity, time, actor, outcome, and cursor values", () => {
    expect(
      securityAuditResponseSchema.safeParse({
        records: [
          {
            ...record,
            id: "12",
            occurredAt: "yesterday",
            outcome: "unknown",
            actor: { membershipId: 7 },
          },
        ],
        nextCursor: "",
      }).success,
    ).toBe(false)
  })
})
