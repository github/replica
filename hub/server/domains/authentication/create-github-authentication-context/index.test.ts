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
    expect(context.secureCookie).toBe(false)
  })

  it("requires repository access evidence when an App installation is configured", () => {
    const context = createGitHubAuthenticationContext({
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      GITHUB_PROVIDER_REVISION: "1",
      HUB_APPLICATION_ORIGIN: "http://localhost:5173",
      HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
    })

    expect(context.requiresProviderAssignmentEvidence).toBe(true)
  })

  it("binds the provider configuration digest to the selected App installation", () => {
    const environment = {
      GITHUB_APP_INSTALLATION_ID: "12345",
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      GITHUB_PROVIDER_REVISION: "1",
      HUB_APPLICATION_ORIGIN: "http://localhost:5173",
      HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
    }

    expect(createGitHubAuthenticationContext(environment).configurationDigest).not.toBe(
      createGitHubAuthenticationContext({ ...environment, GITHUB_APP_INSTALLATION_ID: "67890" })
        .configurationDigest,
    )
  })
})
