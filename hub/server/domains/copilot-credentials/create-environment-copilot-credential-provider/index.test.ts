import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createEnvironmentCopilotCredentialProvider } from "."

describe("createEnvironmentCopilotCredentialProvider()", () => {
  it("exposes a stable identity and returns the configured credential", async () => {
    const provider = createEnvironmentCopilotCredentialProvider({
      REPLICA_COPILOT_TOKEN: "  explicit-token  ",
    })

    expect(provider.key).toBe("environment_token")
    expect(provider.configurationDigest).toBe(
      createHash("sha256").update("explicit-token").digest("hex"),
    )
    await expect(provider.getCredential()).resolves.toEqual({
      githubToken: "explicit-token",
    })
  })

  it("reports no configuration or credential when the environment token is absent", async () => {
    const provider = createEnvironmentCopilotCredentialProvider({})

    expect(provider).toMatchObject({
      key: "environment_token",
      configurationDigest: null,
    })
    await expect(provider.getCredential()).resolves.toBeNull()
  })
})
