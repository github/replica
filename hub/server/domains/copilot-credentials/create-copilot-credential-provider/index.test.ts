import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createCopilotCredentialProvider } from "."

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

  it.each([
    [{ REPLICA_COPILOT_TOKEN: "credential" }, /AUTHENTICATION=environment-token/],
    [
      { REPLICA_COPILOT_AUTHENTICATION: "environment-token" },
      /REPLICA_COPILOT_TOKEN is required/,
    ],
    [
      {
        REPLICA_COPILOT_AUTHENTICATION: "ambient-cli",
        REPLICA_COPILOT_TOKEN: "credential",
      },
      /REPLICA_COPILOT_TOKEN must be unset/,
    ],
    [{ REPLICA_COPILOT_AUTHENTICATION: "unknown" }, /ambient-cli or environment-token/],
  ])("rejects partial or unsupported configuration %#", (environment, message) => {
    expect(() => createCopilotCredentialProvider(environment)).toThrow(message)
  })
})
