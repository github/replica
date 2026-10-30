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
})
