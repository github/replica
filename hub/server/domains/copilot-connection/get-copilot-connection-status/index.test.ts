import { describe, expect, it } from "vitest"

import { getCopilotConnectionStatus } from "."

const connectedBy = {
  login: "octocat",
  membershipId: "9b96cae1-099f-474f-bb1f-6f8ef78a4575",
  name: "The Octocat",
}

describe("getCopilotConnectionStatus()", () => {
  const provider = {
    configurationDigest: "a".repeat(64),
    key: "environment_token" as const,
  }
  const noRefusal = {
    credentialDigest: null,
    credentialProvider: null,
    refusedAt: null,
  }

  it("reports the same provider and configuration as connected", () => {
    const verifiedAt = new Date("2026-11-11T12:00:00.000Z")
    const connection = {
      connectedBy,
      credentialDigest: provider.configurationDigest,
      credentialProvider: provider.key,
      verifiedAt,
    }

    expect(getCopilotConnectionStatus(connection, provider, true, noRefusal)).toEqual({
      configured: true,
      connected: true,
      connectedBy,
      refusedAt: null,
      verifiedAt,
    })
  })

  it("requires reconnecting when the provider changes", () => {
    const connection = {
      connectedBy,
      credentialDigest: provider.configurationDigest,
      credentialProvider: "github_app",
      verifiedAt: new Date("2026-11-11T12:00:00.000Z"),
    }

    expect(getCopilotConnectionStatus(connection, provider, true, noRefusal)).toEqual({
      configured: true,
      connected: false,
      connectedBy: null,
      refusedAt: null,
      verifiedAt: null,
    })
  })

  it("requires reconnecting when the provider configuration changes", () => {
    const connection = {
      connectedBy,
      credentialDigest: "b".repeat(64),
      credentialProvider: provider.key,
      verifiedAt: new Date("2026-11-11T12:00:00.000Z"),
    }

    expect(getCopilotConnectionStatus(connection, provider, true, noRefusal)).toMatchObject({
      connected: false,
      connectedBy: null,
      refusedAt: null,
      verifiedAt: null,
    })
  })

  it("stops reporting a connection when its administrator loses authority", () => {
    const connection = {
      connectedBy,
      credentialDigest: provider.configurationDigest,
      credentialProvider: provider.key,
      verifiedAt: new Date("2026-11-11T12:00:00.000Z"),
    }

    expect(getCopilotConnectionStatus(connection, provider, false, noRefusal)).toMatchObject({
      connected: false,
      connectedBy: null,
    })
  })

  it("reports a refusal only for its provider and configuration identity", () => {
    const refusedAt = new Date("2026-11-11T13:00:00.000Z")
    const connection = {
      connectedBy,
      credentialDigest: provider.configurationDigest,
      credentialProvider: provider.key,
      verifiedAt: new Date("2026-11-11T12:00:00.000Z"),
    }
    const refusal = {
      credentialDigest: provider.configurationDigest,
      credentialProvider: provider.key,
      refusedAt,
    }

    expect(getCopilotConnectionStatus(connection, provider, true, refusal)).toMatchObject({
      connected: false,
      connectedBy,
      refusedAt,
    })
    expect(
      getCopilotConnectionStatus(
        connection,
        { ...provider, configurationDigest: "b".repeat(64) },
        true,
        refusal,
      ),
    ).toMatchObject({
      connectedBy: null,
      refusedAt: null,
    })
  })

  it("does not assign stale verification metadata to a refused rotated credential", () => {
    const rotatedProvider = { ...provider, configurationDigest: "b".repeat(64) }
    const refusedAt = new Date("2026-11-11T13:00:00.000Z")

    expect(
      getCopilotConnectionStatus(
        {
          connectedBy,
          credentialDigest: provider.configurationDigest,
          credentialProvider: provider.key,
          verifiedAt: new Date("2026-11-11T12:00:00.000Z"),
        },
        rotatedProvider,
        true,
        {
          credentialDigest: rotatedProvider.configurationDigest,
          credentialProvider: rotatedProvider.key,
          refusedAt,
        },
      ),
    ).toEqual({
      configured: true,
      connected: false,
      connectedBy: null,
      refusedAt,
      verifiedAt: null,
    })
  })
})
