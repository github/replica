import { describe, expect, it } from "vitest"

import { currentHubSessionSchema } from "@application/hub/administrator-contracts"
import { securityAuditResponseSchema } from "@application/hub/security-audit-contracts"

import { securityAuditPageData } from "."

describe("securityAuditPageData()", () => {
  it("retains supplied order and maps actors, outcomes, bounded context, and opaque pagination", () => {
    const session = currentHubSessionSchema.parse({
      authenticated: true,
      membershipId: "11111111-1111-4111-8111-111111111111",
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: "github",
      login: "octocat",
      name: "The Octocat",
      role: "ADMINISTRATOR",
    })
    const cursor = "opaque+/cursor=="
    const response = securityAuditResponseSchema.parse({
      records: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          occurredAt: "2026-11-10T12:00:00.000Z",
          action: "unknown.future.action",
          outcome: null,
          actor: null,
          context: {},
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          occurredAt: "2026-11-10T11:00:00.000Z",
          action: "administrator.authorization.denied",
          outcome: "denied",
          actor: { membershipId: "44444444-4444-4444-8444-444444444444" },
          context: {
            targetCount: 2,
            providerKeys: ["github", "entra"],
            custom_future_field: "retained",
          },
        },
        {
          id: "55555555-5555-4555-8555-555555555555",
          occurredAt: "2026-11-10T10:00:00.000Z",
          action: "admission.failed",
          outcome: "failure",
          actor: null,
          context: { reason: "transaction_error" },
        },
        {
          id: "66666666-6666-4666-8666-666666666666",
          occurredAt: "2026-11-10T09:00:00.000Z",
          action: "session.ended",
          outcome: "success",
          actor: null,
          context: {
            membershipId: "77777777-7777-4777-8777-777777777777",
            targetId: "88888888-8888-4888-8888-888888888888",
          },
        },
      ],
      nextCursor: cursor,
    })

    const page = securityAuditPageData(session, response)

    expect(page.nextPath).toBe(`/settings/audit?scope=hub&before=${encodeURIComponent(cursor)}`)
    expect(page.events).toEqual([
      expect.objectContaining({
        action: "unknown.future.action",
        actor: "Not available",
        context: [],
        outcome: "Not recorded",
      }),
      expect.objectContaining({
        action: "administrator.authorization.denied",
        actor: "Membership 44444444-4444-4444-8444-444444444444",
        context: [
          { label: "Target count", value: "2" },
          { label: "Providers", value: "github, entra" },
          { label: "Custom future field", value: "retained" },
        ],
        outcome: "Denied",
      }),
      expect.objectContaining({ action: "admission.failed", outcome: "Failed" }),
      expect.objectContaining({
        action: "session.ended",
        actor: "Not available",
        context: [
          { label: "Membership", value: "77777777-7777-4777-8777-777777777777" },
          { label: "Target", value: "88888888-8888-4888-8888-888888888888" },
        ],
        outcome: "Succeeded",
      }),
    ])
  })
})
