import { describe, expect, it } from "vitest"

import { copilotConnectionPageData } from "."

const session = {
  authenticated: true as const,
  membershipId: "9b96cae1-099f-474f-bb1f-6f8ef78a4575",
  userId: "8745dcdf-7212-4108-9d26-e3735b32e940",
  provider: "github",
  login: "octocat",
  name: "The Octocat",
  role: "ADMINISTRATOR" as const,
}

describe("copilotConnectionPageData()", () => {
  it("does not offer connection until the operator configures a credential", () => {
    const data = copilotConnectionPageData(session, {
      configured: false,
      connected: false,
      connectedBy: null,
      refusedAt: null,
      verifiedAt: null,
    })

    expect(data.accessDenied).toBe(false)
    if (data.accessDenied) throw new Error("The administrator must receive connection controls.")
    expect(data.credentialLabel).toMatch(/REPLICA_COPILOT_TOKEN/)
    expect(data.connect).toBeNull()
  })

  it("offers connection for a configured credential that is not verified", () => {
    const data = copilotConnectionPageData(session, {
      configured: true,
      connected: false,
      connectedBy: null,
      refusedAt: null,
      verifiedAt: null,
    })

    expect(data.accessDenied).toBe(false)
    if (data.accessDenied) throw new Error("The administrator must receive connection controls.")
    expect(data.credentialLabel).toBeNull()
    expect(data.connect?.label).toBe("Connect Copilot")
    expect([data.description, data.connect?.consequence].join(" ")).not.toMatch(/\btoken\b/i)
  })
})
