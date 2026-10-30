import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { startAuthenticationProof } from "."

describe("startAuthenticationProof()", () => {
  it("persists only digests and encrypted PKCE material before returning the provider URL", async () => {
    const createAttempt = vi.fn(() => Promise.resolve())
    const createAuthorizationUrl = vi.fn(
      ({ codeChallenge, state }: { codeChallenge: string; state: string }) =>
        new URL(`https://provider.test/authorize?state=${state}&challenge=${codeChallenge}`),
    )
    const opaqueValues = ["state-secret", "browser-secret", "verifier-secret"][Symbol.iterator]()

    const result = await startAuthenticationProof(
      { requestIp: "192.0.2.10" },
      {
        adapter: {
          providerKey: "github",
          createAuthorizationUrl,
          completeAuthenticationProof: vi.fn(),
        },
        callbackUri: "https://hub.test/callback",
        configurationDigest: "a".repeat(64),
        expectedRevision: 1,
        createAttempt,
        createId: () => "00000000-0000-4000-8000-000000000010",
        createOpaqueValue: () => opaqueValues.next().value!,
        deleteExpiredArtifacts: vi.fn(),
        encryptCodeVerifier: (value) => `encrypted:${value.length}`,
        getSelectedProviderRevision: () =>
          Promise.resolve({
            id: "00000000-0000-4000-8000-000000000011",
            revision: 1,
            configurationDigest: "a".repeat(64),
          }),
        now: () => new Date("2026-10-30T16:00:00Z"),
        recentAttemptCount: () => Promise.resolve(0),
        writeDenialAudit: vi.fn(),
      },
    )

    expect(result.browserBinding).toBe("browser-secret")
    expect(createAttempt).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000010",
      providerRevisionId: "00000000-0000-4000-8000-000000000011",
      stateDigest: createHash("sha256").update("state-secret").digest("hex"),
      browserBindingDigest: createHash("sha256").update("browser-secret").digest("hex"),
      requestIpDigest: createHash("sha256").update("192.0.2.10").digest("hex"),
      codeChallenge: createHash("sha256").update("verifier-secret").digest("base64url"),
      codeVerifierCiphertext: "encrypted:15",
      expiresAt: new Date("2026-10-30T16:10:00Z"),
    })
    expect(JSON.stringify(createAttempt.mock.calls)).not.toMatch(
      /state-secret|browser-secret|verifier-secret/,
    )
  })

  it("fails closed before creating an attempt when rate limited or revision drifted", async () => {
    const createAttempt = vi.fn()
    const dependencies = {
      adapter: {
        providerKey: "github",
        createAuthorizationUrl: vi.fn(),
        completeAuthenticationProof: vi.fn(),
      },
      callbackUri: "https://hub.test/callback",
      configurationDigest: "a".repeat(64),
      expectedRevision: 2,
      createAttempt,
      createId: vi.fn(),
      createOpaqueValue: vi.fn(),
      deleteExpiredArtifacts: vi.fn(),
      encryptCodeVerifier: vi.fn(),
      getSelectedProviderRevision: () =>
        Promise.resolve({
          id: "00000000-0000-4000-8000-000000000011",
          revision: 1,
          configurationDigest: "a".repeat(64),
        }),
      now: () => new Date("2026-10-30T16:00:00Z"),
      recentAttemptCount: () => Promise.resolve(10),
      writeDenialAudit: vi.fn(),
    }

    await expect(
      startAuthenticationProof({ requestIp: "192.0.2.10" }, dependencies),
    ).rejects.toMatchObject({ code: "rate_limited" })
    dependencies.recentAttemptCount = () => Promise.resolve(0)
    await expect(
      startAuthenticationProof({ requestIp: "192.0.2.10" }, dependencies),
    ).rejects.toMatchObject({ code: "configuration_changed" })
    expect(createAttempt).not.toHaveBeenCalled()
  })
})
