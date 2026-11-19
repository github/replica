import { describe, expect, it } from "vitest"

import { copilotConnectionPageData } from "."
import { hubWorkspace } from "../hub-workspace"

const membershipId = "9b96cae1-099f-474f-bb1f-6f8ef78a4575"
const workspace = hubWorkspace(
  {
    viewer: {
      id: "8745dcdf-7212-4108-9d26-e3735b32e940",
      login: "octocat",
      name: "The Octocat",
      avatarUrl: null,
    },
    repositories: [],
  },
  new URLSearchParams(),
  "copilot",
)

describe("copilotConnectionPageData()", () => {
  it("does not offer connection until the operator configures a credential", () => {
    const data = copilotConnectionPageData(workspace, {
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
    const data = copilotConnectionPageData(workspace, {
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
    const data = copilotConnectionPageData(workspace, {
      configured: true,
      connected: true,
      savedConnection: true,
      credentialIdentity: null,
      connectedBy: {
        login: "octocat",
        membershipId,
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
    const data = copilotConnectionPageData(workspace, {
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
    const data = copilotConnectionPageData(workspace, {
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
