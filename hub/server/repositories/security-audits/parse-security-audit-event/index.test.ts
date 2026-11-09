import { describe, expect, it } from "vitest"

import { parseSecurityAuditEvent } from "."

describe("parseSecurityAuditEvent()", () => {
  it("uses the shared opaque provider key contract", () => {
    const event = {
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      type: "provider_revision_selected",
      providerId: "df75faa4-ed4c-44ed-8db0-443cc3b426ed",
      providerKey: "GitHub.App/V2",
      revision: 1,
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
    expect(() => parseSecurityAuditEvent({ ...event, providerKey: "provider key" })).toThrow()
  })

  it("rejects unknown event fields", () => {
    expect(() =>
      parseSecurityAuditEvent({
        id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
        type: "provider_revision_validation_failed",
        providerKey: "workforce",
        revision: 1,
        context: {},
      }),
    ).toThrow()
  })

  it("accepts verification-state denial as a bounded authentication audit reason", () => {
    const event = {
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      type: "authentication_attempt_denied",
      provider: "github",
      reason: "verification_state_invalid",
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
  })

  it("accepts bootstrap assignment events without caller-supplied invariant metadata", () => {
    const event = {
      id: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      type: "membership_assignment_created",
      membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
  })

  it.each([
    "provider_membership_assignment_created",
    "provider_membership_assignment_superseded",
    "provider_membership_assignment_revoked",
  ] as const)("accepts bounded provider assignment lifecycle event %s", (type) => {
    const event = {
      assignmentId: "5dd31031-6f1c-4c16-87c2-aee5342145cc",
      id: "df75faa4-ed4c-44ed-8db0-443cc3b426ed",
      membershipId: "8a2479e7-3ca4-46f8-9749-c35d8e4eb09e",
      role: "ADMINISTRATOR" as const,
      type,
    }

    expect(parseSecurityAuditEvent(event)).toEqual(event)
  })
})
