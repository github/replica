import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { StartAuthenticationProofDependencies } from "./types"
import { startAuthenticationProof } from "."

function dependencies(overrides: Partial<StartAuthenticationProofDependencies> = {}) {
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
  const values = {
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
    createOpaqueValue: () => "opaque-value-with-required-length",
    deleteExpiredArtifacts: vi.fn(),
    encryptCodeVerifier: vi.fn(() => "encrypted-verifier"),
    encryptNonce: vi.fn(() => "encrypted-nonce"),
    getAuthenticationProofState: () =>
      Promise.resolve({
        selectedProviderRevision: {
          id: "00000000-0000-4000-8000-000000000011",
          revision: 1,
          configurationDigest: "a".repeat(64),
        },
        sessionRevocationRevision: 0,
      }),
    writeDenialAudit: vi.fn(),
    ...overrides,
  } satisfies StartAuthenticationProofDependencies
  return {
    createAttempt: vi.mocked(values.createAttempt),
    createAuthorizationUrl,
    values,
  }
}

describe("startAuthenticationProof()", () => {
  it("persists only digests and encrypted PKCE material before returning the provider URL", async () => {
    const opaqueValues = ["state-secret", "browser-secret", "verifier-secret", "nonce-secret"][
      Symbol.iterator
    ]()
    const encryptCodeVerifier = vi.fn(
      (value: string) => `encrypted:${createHash("sha256").update(value).digest("hex")}`,
    )
    const scoped = dependencies({
      createOpaqueValue: () => opaqueValues.next().value!,
      encryptCodeVerifier,
      encryptNonce: (value) => `encrypted:${value}`,
    })

    const result = await startAuthenticationProof({ purpose: "SIGN_IN" }, scoped.values)

    const expectedChallenge = createHash("sha256").update("verifier-secret").digest("base64url")
    const expectedCiphertext = `encrypted:${createHash("sha256")
      .update("verifier-secret")
      .digest("hex")}`
    expect(result.browserBinding).toBe("browser-secret")
    expect(scoped.createAuthorizationUrl).toHaveBeenCalledOnce()
    expect(scoped.createAuthorizationUrl).toHaveBeenCalledWith({
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
    expect(scoped.createAttempt).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000010",
      providerRevisionId: "00000000-0000-4000-8000-000000000011",
      stateDigest: createHash("sha256").update("state-secret").digest("hex"),
      browserBindingDigest: createHash("sha256").update("browser-secret").digest("hex"),
      codeVerifierCiphertext: expectedCiphertext,
      lifetimeSeconds: 600,
      nonceCiphertext: "encrypted:nonce-secret",
      purpose: "SIGN_IN",
      sensitiveAuthorizationId: undefined,
      sessionRevocationRevision: 0,
    })
    expect(encryptCodeVerifier).toHaveBeenCalledOnce()
    expect(encryptCodeVerifier).toHaveBeenCalledWith("verifier-secret")
    expect(JSON.stringify(scoped.createAttempt.mock.calls)).not.toMatch(
      /state-secret|browser-secret|verifier-secret/,
    )
  })

  it("reads provider selection and global revocation through one atomic snapshot", async () => {
    const scoped = dependencies({
      getAuthenticationProofState: vi.fn(() =>
        Promise.resolve({
          selectedProviderRevision: {
            configurationDigest: "a".repeat(64),
            id: "00000000-0000-4000-8000-000000000011",
            revision: 1,
          },
          sessionRevocationRevision: 7,
        }),
      ),
    })

    const result = await startAuthenticationProof({ purpose: "SIGN_IN" }, scoped.values)
    expect(result.authorizationUrl).toContain("https://provider.test/authorize")

    expect(scoped.values.getAuthenticationProofState).toHaveBeenCalledOnce()
    expect(scoped.createAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ sessionRevocationRevision: 7 }),
    )
  })

  it.each([
    { purpose: "SIGN_IN", freshAuthentication: false },
    { purpose: "ADMIN_ENROLLMENT", freshAuthentication: true },
  ] as const)(
    "passes freshAuthentication=$freshAuthentication for $purpose",
    async ({ purpose, freshAuthentication }) => {
      const scoped = dependencies()

      await startAuthenticationProof({ purpose }, scoped.values)

      expect(scoped.createAttempt).toHaveBeenCalledWith(expect.objectContaining({ purpose }))
      expect(scoped.createAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({ freshAuthentication }),
      )
    },
  )

  it("binds administrator management proof to one sensitive authorization", async () => {
    const scoped = dependencies()
    const sensitiveAuthorizationId = "00000000-0000-4000-8000-000000000020"

    const result = await startAuthenticationProof(
      { purpose: "ADMINISTRATOR_MANAGEMENT", sensitiveAuthorizationId },
      scoped.values,
    )

    expect(result.authorizationAttemptId).toBe("00000000-0000-4000-8000-000000000010")
    expect(scoped.createAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.authorizationAttemptId,
        purpose: "ADMINISTRATOR_MANAGEMENT",
        sensitiveAuthorizationId,
      }),
    )
    expect(scoped.createAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ freshAuthentication: true }),
    )
  })

  it.each([
    ["administrator management without an authorization", { purpose: "ADMINISTRATOR_MANAGEMENT" }],
    [
      "ordinary sign-in with an authorization",
      {
        purpose: "SIGN_IN",
        sensitiveAuthorizationId: "00000000-0000-4000-8000-000000000020",
      },
    ],
  ] as const)("rejects %s before creating provider state", async (_case, input) => {
    const scoped = dependencies()

    await expect(startAuthenticationProof(input, scoped.values)).rejects.toBeInstanceOf(Error)

    expect(scoped.createAttempt).not.toHaveBeenCalled()
    expect(scoped.createAuthorizationUrl).not.toHaveBeenCalled()
  })

  it("fails closed before creating an attempt when the provider revision drifted", async () => {
    const scoped = dependencies({
      expectedRevision: 2,
    })

    await expect(
      startAuthenticationProof({ purpose: "SIGN_IN" }, scoped.values),
    ).rejects.toMatchObject({
      code: "configuration_changed",
    })
    expect(scoped.createAttempt).not.toHaveBeenCalled()
  })

  it.each([
    ["missing snapshot", null],
    [
      "disabled provider",
      {
        selectedProviderRevision: null,
        sessionRevocationRevision: 1,
      },
    ],
  ] as const)("fails closed without creating state for %s", async (_case, proofState) => {
    const scoped = dependencies({
      getAuthenticationProofState: vi.fn(() => Promise.resolve(proofState)),
    })

    await expect(
      startAuthenticationProof({ purpose: "SIGN_IN" }, scoped.values),
    ).rejects.toMatchObject({
      code: "configuration_changed",
    })

    expect(scoped.createAttempt).not.toHaveBeenCalled()
    expect(scoped.createAuthorizationUrl).not.toHaveBeenCalled()
  })

  it("preserves revision denial and audit failure without creating state", async () => {
    const auditFailure = new Error("audit unavailable")
    const scoped = dependencies({
      expectedRevision: 2,
      writeDenialAudit: () => Promise.reject(auditFailure),
    })

    const error = await startAuthenticationProof({ purpose: "SIGN_IN" }, scoped.values).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ code: "configuration_changed" }),
      auditFailure,
    ])
    expect(scoped.createAttempt).not.toHaveBeenCalled()
  })
})
