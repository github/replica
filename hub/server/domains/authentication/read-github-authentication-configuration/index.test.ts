import { describe, expect, it } from "vitest"

import { readGitHubAuthenticationConfiguration } from "."

const configured = {
  AUTHENTICATION_PROVIDER: "github",
  HUB_APP_ORIGIN: "https://hub.example.test",
  AUTHENTICATION_SECURE_COOKIES: "true",
  AUTHENTICATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
  GITHUB_AUTHENTICATION_REVISION: "2",
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  GITHUB_CALLBACK_URI: "https://hub.example.test/api/auth/github/callback",
  GITHUB_AUTHORIZATION_ENDPOINT: "https://github.com/login/oauth/authorize",
  GITHUB_TOKEN_ENDPOINT: "https://github.com/login/oauth/access_token",
  GITHUB_USER_ENDPOINT: "https://api.github.com/user",
}

describe("readGitHubAuthenticationConfiguration()", () => {
  it("keeps authentication disabled until a provider is explicitly selected", () => {
    expect(readGitHubAuthenticationConfiguration({})).toBeNull()
  })

  it("returns the complete explicit GitHub revision without fallback", () => {
    expect(readGitHubAuthenticationConfiguration(configured)).toMatchObject({
      appOrigin: "https://hub.example.test",
      revision: 2,
      secureCookies: true,
      publicConfiguration: {
        clientId: "client-id",
        callbackUri: "https://hub.example.test/api/auth/github/callback",
      },
    })
  })

  it("rejects partial, unsupported, or invalid-key configuration", () => {
    expect(() =>
      readGitHubAuthenticationConfiguration({
        ...configured,
        AUTHENTICATION_PROVIDER: "entra",
      }),
    ).toThrow()
    expect(() =>
      readGitHubAuthenticationConfiguration({
        ...configured,
        GITHUB_CLIENT_SECRET: undefined,
      }),
    ).toThrow()
    expect(() =>
      readGitHubAuthenticationConfiguration({
        ...configured,
        AUTHENTICATION_ENCRYPTION_KEY: "too-short",
      }),
    ).toThrow("32 bytes")
  })

  it.each([
    "https://hub.example.test/",
    "https://hub.example.test/path",
    "https://hub.example.test?query=1",
    "https://hub.example.test#fragment",
    "https://user@hub.example.test",
  ])("rejects HUB_APP_ORIGIN that is not an exact origin: %s", (appOrigin) => {
    expect(() =>
      readGitHubAuthenticationConfiguration({ ...configured, HUB_APP_ORIGIN: appOrigin }),
    ).toThrow("exact origin")
  })

  it("accepts an exact origin with an explicit port", () => {
    expect(
      readGitHubAuthenticationConfiguration({
        ...configured,
        HUB_APP_ORIGIN: "https://hub.example.test:8443",
      })?.appOrigin,
    ).toBe("https://hub.example.test:8443")
  })

  it("rejects non-github.com provider endpoints", () => {
    expect(() =>
      readGitHubAuthenticationConfiguration({
        ...configured,
        GITHUB_USER_ENDPOINT: "https://github.enterprise.test/api/v3/user",
      }),
    ).toThrow()
  })
})
