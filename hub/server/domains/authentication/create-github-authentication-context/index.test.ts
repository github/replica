import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createGitHubAuthenticationContext } from "."

describe("createGitHubAuthenticationContext()", () => {
  it("accepts the bracketed IPv6 loopback hostname for local HTTP", () => {
    const context = createGitHubAuthenticationContext({
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      GITHUB_PROVIDER_REVISION: "1",
      HUB_APPLICATION_ORIGIN: "http://[::1]:5173",
      HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
    })

    expect(context.applicationOrigin).toBe("http://[::1]:5173")
    expect(context.callbackUri).toBe("http://[::1]:5173/api/auth/github/callback")
    expect(context.requiresProviderAssignmentEvidence).toBe(false)
    expect(context.requiresFreshAdministratorEnrollment).toBe(false)
    expect(context.secureCookie).toBe(false)
  })
})
