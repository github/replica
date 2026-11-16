import { createHash, generateKeyPairSync } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createCopilotCredentialProvider } from "."

function privateKey() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({
      format: "pem",
      type: "pkcs8",
    })
    .toString()
}

describe("createCopilotCredentialProvider()", () => {
  it("does not choose a personal credential provider by default", async () => {
    const provider = createCopilotCredentialProvider({})

    expect(provider).toMatchObject({ key: "unconfigured", configurationDigest: null })
    await expect(provider.getCredential()).resolves.toBeNull()
  })

  it("supports explicit ambient CLI authentication without a token", async () => {
    const provider = createCopilotCredentialProvider({
      REPLICA_COPILOT_AUTHENTICATION: "ambient-cli",
    })

    expect(provider).toMatchObject({
      key: "ambient_cli",
      configurationDigest: createHash("sha256").update("ambient_cli:v1").digest("hex"),
    })
    await expect(provider.getCredential()).resolves.toEqual({})
  })

  it("supports an explicitly selected environment-token provider", async () => {
    const provider = createCopilotCredentialProvider({
      REPLICA_COPILOT_AUTHENTICATION: "environment-token",
      REPLICA_COPILOT_TOKEN: "credential",
    })

    expect(provider.key).toBe("environment_token")
    await expect(provider.getCredential()).resolves.toEqual({ githubToken: "credential" })
  })

  it("supports an explicitly selected GitHub App installation provider", () => {
    const provider = createCopilotCredentialProvider({
      REPLICA_COPILOT_AUTHENTICATION: "github-app-installation",
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: privateKey(),
      REPLICA_COPILOT_GITHUB_INSTALLATION_ID: "456",
      REPLICA_COPILOT_GITHUB_ORGANIZATION: "GitHub",
    })

    expect(provider).toMatchObject({
      key: "github_app_installation",
      githubAppInstallation: {
        appId: "123",
        installationId: "456",
        organization: "github",
      },
    })
  })

  it.each([
    [{ REPLICA_COPILOT_TOKEN: "credential" }, /AUTHENTICATION=environment-token/],
    [{ GITHUB_APP_ID: "123" }, /AUTHENTICATION=github-app-installation/],
    [{ REPLICA_COPILOT_AUTHENTICATION: "environment-token" }, /REPLICA_COPILOT_TOKEN is required/],
    [
      {
        REPLICA_COPILOT_AUTHENTICATION: "ambient-cli",
        REPLICA_COPILOT_TOKEN: "credential",
      },
      /must be unset/,
    ],
    [
      {
        REPLICA_COPILOT_AUTHENTICATION: "ambient-cli",
        GITHUB_APP_ID: "123",
      },
      /must be unset/,
    ],
    [
      {
        REPLICA_COPILOT_AUTHENTICATION: "environment-token",
        REPLICA_COPILOT_TOKEN: "credential",
        REPLICA_COPILOT_GITHUB_ORGANIZATION: "github",
      },
      /GitHub App configuration must be unset/,
    ],
    [
      {
        REPLICA_COPILOT_AUTHENTICATION: "github-app-installation",
        REPLICA_COPILOT_TOKEN: "credential",
      },
      /REPLICA_COPILOT_TOKEN must be unset/,
    ],
    [
      {
        REPLICA_COPILOT_AUTHENTICATION: "github-app-installation",
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        REPLICA_COPILOT_GITHUB_ORGANIZATION: "github",
      },
      /REPLICA_COPILOT_GITHUB_INSTALLATION_ID/,
    ],
    [{ REPLICA_COPILOT_AUTHENTICATION: "unknown" }, /github-app-installation/],
  ])("rejects partial or unsupported configuration %#", (environment, message) => {
    expect(() => createCopilotCredentialProvider(environment)).toThrow(message)
  })
})
