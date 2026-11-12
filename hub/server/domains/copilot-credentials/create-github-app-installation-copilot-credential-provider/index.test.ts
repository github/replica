import { createVerify, generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { createGitHubAppInstallationCopilotCredentialProvider } from "."

function configuration(privateKey: string, overrides: NodeJS.ProcessEnv = {}) {
  return {
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: privateKey,
    REPLICA_COPILOT_GITHUB_INSTALLATION_ID: "456",
    REPLICA_COPILOT_GITHUB_ORGANIZATION: "GitHub",
    ...overrides,
  }
}

function privateKey() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({
      format: "pem",
      type: "pkcs8",
    })
    .toString()
}

describe("createGitHubAppInstallationCopilotCredentialProvider()", () => {
  it("uses only the App and installation identity for its stable configuration digest", () => {
    const firstPrivateKey = privateKey()
    const original = createGitHubAppInstallationCopilotCredentialProvider(
      configuration(firstPrivateKey),
    )
    const rotatedKey = createGitHubAppInstallationCopilotCredentialProvider(
      configuration(privateKey()),
    )

    expect(original.githubAppInstallation).toEqual({
      appId: "123",
      installationId: "456",
      organization: "github",
    })
    expect(rotatedKey.configurationDigest).toBe(original.configurationDigest)
    expect(
      createGitHubAppInstallationCopilotCredentialProvider(
        configuration(firstPrivateKey, { GITHUB_APP_ID: "124" }),
      ).configurationDigest,
    ).not.toBe(original.configurationDigest)
    expect(
      createGitHubAppInstallationCopilotCredentialProvider(
        configuration(firstPrivateKey, {
          REPLICA_COPILOT_GITHUB_INSTALLATION_ID: "457",
        }),
      ).configurationDigest,
    ).not.toBe(original.configurationDigest)
    expect(
      createGitHubAppInstallationCopilotCredentialProvider(
        configuration(firstPrivateKey, {
          REPLICA_COPILOT_GITHUB_ORGANIZATION: "octo-org",
        }),
      ).configurationDigest,
    ).not.toBe(original.configurationDigest)
  })

  it("uses the configured local private key through the signer boundary", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString()
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            account: { login: "GitHub", type: "Organization" },
            app_id: 123,
            id: 456,
            permissions: { organization_copilot_requests: "read" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            expires_at: "2026-11-12T19:00:00.000Z",
            permissions: { organization_copilot_requests: "read" },
            token: "installation-token",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
    vi.stubGlobal("fetch", request)
    vi.setSystemTime(new Date("2026-11-12T18:00:00.000Z"))
    const provider = createGitHubAppInstallationCopilotCredentialProvider(
      configuration(privateKeyPem),
    )

    await expect(provider.getCredential()).resolves.toEqual({
      expiresAt: new Date("2026-11-12T19:00:00.000Z"),
      githubToken: "installation-token",
    })

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/app/installations/456",
      "https://api.github.com/app/installations/456/access_tokens",
    ])
    const authorization = new Headers(request.mock.calls[0]?.[1]?.headers).get("authorization")
    const jwt = authorization?.replace("Bearer ", "") ?? ""
    const [header, payload, signature] = jwt.split(".")
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({
      exp: 1_794_506_940,
      iat: 1_794_506_340,
      iss: "123",
    })
    const verifier = createVerify("RSA-SHA256")
    verifier.update(`${header}.${payload}`)
    verifier.end()
    expect(verifier.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true)
  })

  it("reports invalid identity settings in plain language", () => {
    expect(() =>
      createGitHubAppInstallationCopilotCredentialProvider({
        GITHUB_APP_ID: "not-an-id",
        GITHUB_APP_PRIVATE_KEY: privateKey(),
        REPLICA_COPILOT_GITHUB_INSTALLATION_ID: "",
        REPLICA_COPILOT_GITHUB_ORGANIZATION: "-invalid",
      }),
    ).toThrow(
      "GITHUB_APP_ID, REPLICA_COPILOT_GITHUB_INSTALLATION_ID, REPLICA_COPILOT_GITHUB_ORGANIZATION must provide positive numeric App and installation IDs and a valid organization login.",
    )
  })
})
