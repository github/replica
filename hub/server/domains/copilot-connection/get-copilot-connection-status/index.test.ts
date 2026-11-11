import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { getCopilotConnectionStatus } from "."

const connectedBy = {
  login: "octocat",
  membershipId: "9b96cae1-099f-474f-bb1f-6f8ef78a4575",
  name: "The Octocat",
}

describe("getCopilotConnectionStatus()", () => {
  it("reports only the token an administrator verified as connected", () => {
    const verifiedAt = new Date("2026-11-11T12:00:00.000Z")
    const connection = {
      connectedBy,
      refusedAt: null,
      tokenDigest: createHash("sha256").update("verified-token").digest("hex"),
      verifiedAt,
    }

    expect(getCopilotConnectionStatus(connection, "verified-token", true)).toEqual({
      configured: true,
      connected: true,
      connectedBy,
      refusedAt: null,
      verifiedAt,
    })
    expect(getCopilotConnectionStatus(connection, "replacement-token", true)).toEqual({
      configured: true,
      connected: false,
      connectedBy: null,
      refusedAt: null,
      verifiedAt: null,
    })
  })

  it("stops reporting a connection when its administrator loses authority", () => {
    const connection = {
      connectedBy,
      refusedAt: null,
      tokenDigest: createHash("sha256").update("verified-token").digest("hex"),
      verifiedAt: new Date("2026-11-11T12:00:00.000Z"),
    }

    expect(getCopilotConnectionStatus(connection, "verified-token", false)).toMatchObject({
      connected: false,
      connectedBy: null,
    })
  })

  it("reports a refusal for the verified token without treating it as connected", () => {
    const refusedAt = new Date("2026-11-11T13:00:00.000Z")
    const connection = {
      connectedBy,
      refusedAt,
      tokenDigest: createHash("sha256").update("verified-token").digest("hex"),
      verifiedAt: new Date("2026-11-11T12:00:00.000Z"),
    }

    expect(getCopilotConnectionStatus(connection, "verified-token", true)).toMatchObject({
      connected: false,
      connectedBy,
      refusedAt,
    })
  })
})
