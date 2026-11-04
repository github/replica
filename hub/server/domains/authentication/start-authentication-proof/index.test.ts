import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { startAuthenticationProof } from "."

describe("startAuthenticationProof()", () => {
  it("persists only digests and encrypted PKCE material before returning the provider URL", async () => {
    const createAttempt = vi.fn(() =>
      Promise.resolve({ expiresAt: new Date("2026-10-30T16:10:00Z") }),
    )
    const createAuthorizationUrl = vi.fn(
      ({ codeChallenge, state }: { codeChallenge: string; state: string }) => {
        const url = new URL("https://provider.test/authorize")
        url.search = new URLSearchParams({
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        }).toString()
        return url
      },
    )
    const opaqueValues = ["state-secret", "browser-secret", "verifier-secret", "nonce-secret"][
      Symbol.iterator
    ]()
    const encryptCodeVerifier = vi.fn(
      (value: string) => `encrypted:${createHash("sha256").update(value).digest("hex")}`,
    )

    const result = await startAuthenticationProof(
      { purpose: "SIGN_IN" },
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
        encryptCodeVerifier,
        encryptNonce: vi.fn((value: string) => `encrypted:${value}`),
        getSelectedProviderRevision: () =>
          Promise.resolve({
            id: "00000000-0000-4000-8000-000000000011",
            revision: 1,
            configurationDigest: "a".repeat(64),
          }),
        writeDenialAudit: vi.fn(),
      },
    )

    const expectedChallenge = createHash("sha256").update("verifier-secret").digest("base64url")
    const expectedCiphertext = `encrypted:${createHash("sha256")
      .update("verifier-secret")
      .digest("hex")}`
    expect(result.browserBinding).toBe("browser-secret")
    expect(createAuthorizationUrl).toHaveBeenCalledOnce()
    expect(createAuthorizationUrl).toHaveBeenCalledWith({
      callbackUri: "https://hub.test/callback",
      codeChallenge: expectedChallenge,
      freshAuthentication: false,
      nonce: "nonce-secret",
      state: "state-secret",
    })
    const authorizationUrl = new URL(result.authorizationUrl)
    expect(authorizationUrl.searchParams.get("state")).toBe("state-secret")
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(expectedChallenge)
    expect(authorizationUrl.searchParams.get("code_challenge")).not.toBe("verifier-secret")
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256")
    expect(createAttempt).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000010",
      providerRevisionId: "00000000-0000-4000-8000-000000000011",
      stateDigest: createHash("sha256").update("state-secret").digest("hex"),
      browserBindingDigest: createHash("sha256").update("browser-secret").digest("hex"),
      codeVerifierCiphertext: expectedCiphertext,
      lifetimeSeconds: 600,
      nonceCiphertext: "encrypted:nonce-secret",
      purpose: "SIGN_IN",
    })
    expect(encryptCodeVerifier).toHaveBeenCalledOnce()
    expect(encryptCodeVerifier).toHaveBeenCalledWith("verifier-secret")
    expect(JSON.stringify(createAttempt.mock.calls)).not.toMatch(
      /state-secret|browser-secret|verifier-secret/,
    )
  })

  it("requests fresh authentication only for administrator enrollment", async () => {
    const createAuthorizationUrl = vi.fn(() => new URL("https://provider.test/authorize"))
    const createAttempt = vi.fn(() =>
      Promise.resolve({ expiresAt: new Date("2026-10-30T16:10:00Z") }),
    )

    await startAuthenticationProof(
      { purpose: "ADMIN_ENROLLMENT" },
      {
        adapter: {
          providerKey: "entra",
          createAuthorizationUrl,
          completeAuthenticationProof: vi.fn(),
        },
        callbackUri: "https://hub.test/callback",
        configurationDigest: "a".repeat(64),
        expectedRevision: 1,
        createAttempt,
        createId: () => "00000000-0000-4000-8000-000000000010",
        createOpaqueValue: () => "opaque-value-with-required-length",
        deleteExpiredArtifacts: vi.fn(),
        encryptCodeVerifier: vi.fn(() => "encrypted-verifier"),
        encryptNonce: vi.fn(() => "encrypted-nonce"),
        getSelectedProviderRevision: () =>
          Promise.resolve({
            id: "00000000-0000-4000-8000-000000000011",
            revision: 1,
            configurationDigest: "a".repeat(64),
          }),
        writeDenialAudit: vi.fn(),
      },
    )

    expect(createAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "ADMIN_ENROLLMENT" }),
    )
    expect(createAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ freshAuthentication: true }),
    )
  })

  it("fails closed before creating an attempt when the provider revision drifted", async () => {
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
      encryptNonce: vi.fn(),
      getSelectedProviderRevision: () =>
        Promise.resolve({
          id: "00000000-0000-4000-8000-000000000011",
          revision: 1,
          configurationDigest: "a".repeat(64),
        }),
      now: () => new Date("2026-10-30T16:00:00Z"),
      writeDenialAudit: vi.fn(),
    }

    await expect(
      startAuthenticationProof({ purpose: "SIGN_IN" }, dependencies),
    ).rejects.toMatchObject({
      code: "configuration_changed",
    })
    expect(createAttempt).not.toHaveBeenCalled()
  })

  it("preserves revision denial and audit failure without creating state", async () => {
    const createAttempt = vi.fn()
    const auditFailure = new Error("audit unavailable")

    const error = await startAuthenticationProof(
      { purpose: "SIGN_IN" },
      {
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
        encryptNonce: vi.fn(),
        getSelectedProviderRevision: () =>
          Promise.resolve({
            id: "00000000-0000-4000-8000-000000000011",
            revision: 1,
            configurationDigest: "a".repeat(64),
          }),
        writeDenialAudit: () => Promise.reject(auditFailure),
      },
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ code: "configuration_changed" }),
      auditFailure,
    ])
    expect(createAttempt).not.toHaveBeenCalled()
  })
})
