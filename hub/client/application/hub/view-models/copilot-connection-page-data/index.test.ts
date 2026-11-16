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
      savedConnection: false,
      credentialIdentity: null,
      connectedBy: null,
      refusedAt: null,
      verifiedAt: null,
    })

    expect(data.accessDenied).toBe(false)
    if (data.accessDenied) throw new Error("The administrator must receive connection controls.")
    expect(data.credentialLabel).toMatch(/credential provider/)
    expect(data.connect).toBeNull()
  })

  it("offers connection for a configured credential that is not verified", () => {
    const data = copilotConnectionPageData(session, {
      configured: true,
      connected: false,
      savedConnection: false,
      credentialIdentity: null,
      connectedBy: null,
      refusedAt: null,
      verifiedAt: null,
    })

    expect(data.accessDenied).toBe(false)
    if (data.accessDenied) throw new Error("The administrator must receive connection controls.")
    expect(data.credentialLabel).toBeNull()
    expect(data.connect?.label).toBe("Connect Copilot")
    expect([data.description, data.connect?.consequence].join(" ")).not.toMatch(
      /operator-provided token|configured token/i,
    )
  })

  it("offers an explicit recheck and disconnect for an active saved connection", () => {
    const data = copilotConnectionPageData(session, {
      configured: true,
      connected: true,
      savedConnection: true,
      credentialIdentity: null,
      connectedBy: {
        login: "octocat",
        membershipId: session.membershipId,
        name: "The Octocat",
      },
      refusedAt: null,
      verifiedAt: "2026-11-10T23:00:00.000Z",
    })

    expect(data.accessDenied).toBe(false)
    if (data.accessDenied) throw new Error("The administrator must receive connection controls.")
    expect(data.connect?.label).toBe("Check Copilot connection")
    expect(data.disconnect?.label).toBe("Disconnect Copilot")
  })

  it("keeps disconnect available when a saved connection is inactive", () => {
    const data = copilotConnectionPageData(session, {
      configured: true,
      connected: false,
      savedConnection: true,
      credentialIdentity: null,
      connectedBy: null,
      refusedAt: "2026-11-11T13:00:00.000Z",
      verifiedAt: null,
    })

    expect(data.accessDenied).toBe(false)
    if (data.accessDenied) throw new Error("The administrator must receive connection controls.")
    expect(data.connect?.label).toBe("Connect Copilot")
    expect(data.disconnect?.label).toBe("Disconnect Copilot")
  })

  it("names the billed organization and GitHub App for installation credentials", () => {
    const data = copilotConnectionPageData(session, {
      configured: true,
      connected: false,
      savedConnection: false,
      credentialIdentity: {
        appId: "123",
        installationId: "456",
        organization: "github",
      },
      connectedBy: null,
      refusedAt: null,
      verifiedAt: null,
    })

    expect(data.accessDenied).toBe(false)
    if (data.accessDenied) throw new Error("The administrator must receive connection controls.")
    expect(data.usageLabel).toMatch(/billed to the github organization through GitHub App 123/)
    expect(data.connect?.consequence).toMatch(/github organization through GitHub App 123/)
    expect([data.usageLabel, data.connect?.consequence].join(" ")).not.toContain("456")
  })
})
