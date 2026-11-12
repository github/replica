import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createLocalAuthenticationContext } from "."

function environment(applicationOrigin = "http://127.0.0.1:5173") {
  return {
    HUB_APPLICATION_ORIGIN: applicationOrigin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
  }
}

describe("createLocalAuthenticationContext()", () => {
  it("keeps the current revision when local sign-in restarts unchanged", () => {
    const current = createLocalAuthenticationContext(environment(), null)

    const restarted = createLocalAuthenticationContext(environment(), {
      configurationDigest: current.configurationDigest,
      enabled: true,
      revision: 3,
    })

    expect(restarted.providerRevision).toBe(3)
  })

  it("moves to the next revision when the application origin changes", () => {
    const current = createLocalAuthenticationContext(environment(), null)

    const moved = createLocalAuthenticationContext(environment("http://localhost:5173"), {
      configurationDigest: current.configurationDigest,
      enabled: true,
      revision: 3,
    })

    expect(moved.providerRevision).toBe(4)
  })
})
