import { describe, expect, it } from "vitest"

import { securityAuditResponseSchema } from "."

const record = {
  id: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-11-10T12:00:00.000Z",
  action: "identity.provider_revision.selected",
  outcome: "success",
  actor: { membershipId: "22222222-2222-4222-8222-222222222222" },
  context: {
    provider: "corp.auth.v2",
    revision: 3,
    providerKeys: ["github", "entra"],
  },
}

describe("securityAuditResponseSchema", () => {
  it("accepts provider-neutral UUID records, a dotted provider, and a nullable opaque cursor", () => {
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

  it("accepts a credential provider only under the safe provider key", () => {
    const context = { phase: "connected", provider: "environment_token" }

    expect(
      securityAuditResponseSchema.parse({
        records: [{ ...record, action: "copilot.connection.connected", context }],
        nextCursor: null,
      }).records[0]?.context,
    ).toEqual(context)
    expect(
      securityAuditResponseSchema.safeParse({
        records: [
          {
            ...record,
            action: "copilot.connection.connected",
            context: { credentialProvider: "environment_token", phase: "connected" },
          },
        ],
        nextCursor: null,
      }).success,
    ).toBe(false)
  })

  it.each([
    ["a nested object", { metadata: { provider: "github" } }],
    ["a non-integer number", { revision: 1.5 }],
    ["a mixed array", { providerKeys: ["github", 2] }],
    ["a secret-bearing field", { accessToken: "public-provider-label" }],
    ["credential-shaped text", { reason: "Bearer private-credential-value" }],
  ])("rejects context containing %s", (_label, context) => {
    expect(
      securityAuditResponseSchema.safeParse({
        records: [{ ...record, context }],
        nextCursor: null,
      }).success,
    ).toBe(false)
  })

  it.each([
    ["record identity", { id: "12" }, null],
    ["record time", { occurredAt: "yesterday" }, null],
    ["actor membership identity", { actor: { membershipId: 7 } }, null],
    ["outcome", { outcome: "unknown" }, null],
    ["cursor", {}, ""],
  ] as Array<[string, Record<string, unknown>, string | null]>)(
    "rejects a malformed %s independently",
    (_label, recordPatch, nextCursor) => {
      expect(
        securityAuditResponseSchema.safeParse({
          records: [{ ...record, ...recordPatch }],
          nextCursor,
        }).success,
      ).toBe(false)
    },
  )
})
