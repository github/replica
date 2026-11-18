import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"

import { readAuthenticationConfigurationState } from "."

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const signIn = {
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  GITHUB_PROVIDER_REVISION: "1",
}
const app = {
  GITHUB_APP_ID: "123",
  GITHUB_APP_INSTALLATION_ID: "456",
  GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(
    privateKey.export({ format: "pem", type: "pkcs1" }),
  ).toString("base64"),
  GITHUB_WEBHOOK_SECRET: "webhook-secret-at-least-twenty-characters",
}

describe("readAuthenticationConfigurationState()", () => {
  it("keeps GitHub disabled until the entire App is configured", () => {
    const result = readAuthenticationConfigurationState(signIn)

    expect(result.githubConfigured).toBe(false)
    expect(result.githubStatus).toBe("incomplete")
    expect(result.githubProblems).toEqual(
      expect.arrayContaining([
        { key: "GITHUB_APP_ID", state: "missing" },
        { key: "GITHUB_APP_INSTALLATION_ID", state: "missing" },
        { key: "GITHUB_APP_PRIVATE_KEY_BASE64", state: "missing" },
        { key: "GITHUB_WEBHOOK_SECRET", state: "missing" },
      ]),
    )
  })

  it("enables GitHub after all App and sign-in settings are valid", () => {
    const result = readAuthenticationConfigurationState({ ...signIn, ...app })

    expect(result.githubConfigured).toBe(true)
    expect(result.githubStatus).toBe("configured")
    expect(result.githubProblems).toEqual([])
  })

  it.each([
    [
      "PEM",
      { GITHUB_APP_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs1" }).toString() },
    ],
    ["base64", { GITHUB_APP_PRIVATE_KEY_BASE64: app.GITHUB_APP_PRIVATE_KEY_BASE64 }],
  ])("does not enable GitHub sign-in for a Copilot-only App with a %s key", (_format, key) => {
    const result = readAuthenticationConfigurationState({
      REPLICA_COPILOT_AUTHENTICATION: "github-app-installation",
      GITHUB_APP_ID: "123",
      REPLICA_COPILOT_GITHUB_INSTALLATION_ID: "456",
      REPLICA_COPILOT_GITHUB_ORGANIZATION: "github",
      ...key,
    })

    expect(result).toMatchObject({
      githubConfigured: false,
      githubSettingsPresent: false,
      githubStatus: "not_configured",
      githubProblems: [],
      providerConfigured: false,
    })
  })

  it.each([
    ["sign-in", { GITHUB_CLIENT_ID: "client-id" }, "GITHUB_CLIENT_SECRET", "missing"],
    [
      "installation",
      { GITHUB_APP_INSTALLATION_ID: "invalid" },
      "GITHUB_APP_INSTALLATION_ID",
      "invalid",
    ],
    ["webhook", { GITHUB_WEBHOOK_SECRET: "short" }, "GITHUB_WEBHOOK_SECRET", "invalid"],
  ])(
    "recognizes and validates GitHub %s settings alongside Copilot",
    (_kind, settings, key, state) => {
      const result = readAuthenticationConfigurationState({
        REPLICA_COPILOT_AUTHENTICATION: "github-app-installation",
        GITHUB_APP_ID: app.GITHUB_APP_ID,
        GITHUB_APP_PRIVATE_KEY_BASE64: app.GITHUB_APP_PRIVATE_KEY_BASE64,
        ...settings,
      })

      expect(result).toMatchObject({
        githubConfigured: false,
        githubSettingsPresent: true,
        githubStatus: "incomplete",
      })
      expect(result.githubProblems).toContainEqual({ key, state })
    },
  )
})
