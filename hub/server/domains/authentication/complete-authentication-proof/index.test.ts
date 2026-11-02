import { describe, expect, it, vi } from "vitest"

import { AuthenticationProofError } from "../errors"
import type { CompleteAuthenticationProofDependencies } from "./types"
import type { AuthenticationProofResult, AuthenticationProviderAdapter } from "../types"
import { completeAuthenticationProof } from "."

const revision = {
  id: "00000000-0000-4000-8000-000000000011",
  revision: 1,
  configurationDigest: "a".repeat(64),
}

function dependencies() {
  const completeProvider = vi.fn<AuthenticationProviderAdapter["completeAuthenticationProof"]>(() =>
    Promise.resolve({
      provider: "github",
      issuer: "https://github.com",
      subject: "123",
    }),
  )
  const consumeAttempt = vi.fn<CompleteAuthenticationProofDependencies["consumeAttempt"]>(() =>
    Promise.resolve({
      id: "00000000-0000-4000-8000-000000000010",
      providerRevisionId: revision.id,
      codeVerifierCiphertext: "encrypted-verifier",
    }),
  )
  return {
    adapter: {
      providerKey: "github",
      createAuthorizationUrl: vi.fn(),
      completeAuthenticationProof: completeProvider,
    },
    callbackUri: "https://hub.example.test/api/auth/github/callback",
    consumeAttempt,
    decryptCodeVerifier: vi.fn(() => "pkce-verifier"),
    localConfigurationDigest: revision.configurationDigest,
    localRevision: revision.revision,
    getSelectedProviderRevision: vi.fn(() => Promise.resolve(revision)),
    resolveOrCreateIdentity: vi.fn(() =>
      Promise.resolve({
        externalIdentityId: "00000000-0000-4000-8000-000000000012",
        userId: "00000000-0000-4000-8000-000000000013",
      }),
    ),
    writeDenialAudit: vi.fn(() => Promise.resolve()),
  }
}

describe("completeAuthenticationProof()", () => {
  it("returns only the bounded internal proof references", async () => {
    const result = await completeAuthenticationProof(
      {
        browserBinding: "browser-binding-value-with-required-length",
        code: "authorization-code",
        state: "state-value-with-the-required-minimum-length",
      },
      dependencies(),
    )

    expect(result.proof).toEqual<AuthenticationProofResult>({
      authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
      externalIdentityId: "00000000-0000-4000-8000-000000000012",
    })
    expect(Object.keys(result.proof).sort()).toEqual([
      "authorizationAttemptId",
      "externalIdentityId",
    ])
  })

  it("consumes the browser-bound attempt before provider work", async () => {
    const order: string[] = []
    const scoped = dependencies()
    scoped.consumeAttempt.mockImplementation(() => {
      order.push("consume")
      return Promise.resolve({
        id: "00000000-0000-4000-8000-000000000010",
        providerRevisionId: revision.id,
        codeVerifierCiphertext: "encrypted-verifier",
      })
    })
    scoped.adapter.completeAuthenticationProof.mockImplementation(() => {
      order.push("provider")
      return Promise.resolve({
        provider: "github",
        issuer: "https://github.com",
        subject: "123",
      })
    })

    await completeAuthenticationProof(
      {
        browserBinding: "browser-binding-value-with-required-length",
        code: "authorization-code",
        state: "state-value-with-the-required-minimum-length",
      },
      scoped,
    )
    expect(order).toEqual(["consume", "provider"])
  })

  it("fails closed before provider work for replay or configuration drift", async () => {
    const replay = dependencies()
    replay.consumeAttempt.mockImplementationOnce(() => Promise.resolve(null))
    await expect(
      completeAuthenticationProof(
        {
          browserBinding: "browser-binding-value-with-required-length",
          code: "authorization-code",
          state: "state-value-with-the-required-minimum-length",
        },
        replay,
      ),
    ).rejects.toMatchObject({ code: "attempt_invalid" })
    expect(replay.adapter.completeAuthenticationProof).not.toHaveBeenCalled()

    const drift = dependencies()
    drift.getSelectedProviderRevision.mockResolvedValueOnce({
      ...revision,
      configurationDigest: "b".repeat(64),
    })
    await expect(
      completeAuthenticationProof(
        {
          browserBinding: "browser-binding-value-with-required-length",
          code: "authorization-code",
          state: "state-value-with-the-required-minimum-length",
        },
        drift,
      ),
    ).rejects.toMatchObject({ code: "configuration_changed" })
    expect(drift.adapter.completeAuthenticationProof).not.toHaveBeenCalled()
  })

  it("rejects when the selected revision changes after provider proof", async () => {
    const scoped = dependencies()
    scoped.getSelectedProviderRevision
      .mockResolvedValueOnce(revision)
      .mockResolvedValueOnce({ ...revision, configurationDigest: "b".repeat(64) })

    await expect(
      completeAuthenticationProof(
        {
          browserBinding: "browser-binding-value-with-required-length",
          code: "authorization-code",
          state: "state-value-with-the-required-minimum-length",
        },
        scoped,
      ),
    ).rejects.toMatchObject({ code: "configuration_changed" })

    expect(scoped.getSelectedProviderRevision).toHaveBeenCalledTimes(2)
    expect(scoped.adapter.completeAuthenticationProof).toHaveBeenCalledOnce()
    expect(scoped.writeDenialAudit).toHaveBeenCalledOnce()
    expect(scoped.writeDenialAudit).toHaveBeenCalledWith("configuration_changed")
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
  })

  it("reports invalid local verification state without calling the provider", async () => {
    const scoped = dependencies()
    const rawFailure = new Error(
      "Unsupported state or unable to authenticate data: verifier-ciphertext-secret",
    )
    scoped.decryptCodeVerifier.mockImplementationOnce(() => {
      throw rawFailure
    })

    const error = await completeAuthenticationProof(
      {
        browserBinding: "browser-binding-value-with-required-length",
        code: "authorization-code",
        state: "state-value-with-the-required-minimum-length",
      },
      scoped,
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AuthenticationProofError)
    const authenticationError = error as AuthenticationProofError
    expect(authenticationError.code).toBe("verification_state_invalid")
    expect(authenticationError.message).not.toMatch(/authenticate|ciphertext|secret|unsupported/i)
    expect(authenticationError.cause).toBeUndefined()
    expect(scoped.adapter.completeAuthenticationProof).not.toHaveBeenCalled()
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
    expect(scoped.writeDenialAudit).toHaveBeenCalledOnce()
    expect(scoped.writeDenialAudit).toHaveBeenCalledWith("verification_state_invalid")
  })

  it("preserves safe verification-state denial when its audit fails", async () => {
    const scoped = dependencies()
    const rawFailure = new Error(
      "Unsupported state or unable to authenticate data: verifier-ciphertext-secret",
    )
    const auditFailure = new Error("audit unavailable")
    scoped.decryptCodeVerifier.mockImplementationOnce(() => {
      throw rawFailure
    })
    scoped.writeDenialAudit.mockRejectedValueOnce(auditFailure)

    const error = await completeAuthenticationProof(
      {
        browserBinding: "browser-binding-value-with-required-length",
        code: "authorization-code",
        state: "state-value-with-the-required-minimum-length",
      },
      scoped,
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AggregateError)
    const [primary, audit] = (error as AggregateError).errors as [Error, Error]
    expect(primary).toBeInstanceOf(AuthenticationProofError)
    const authenticationError = primary as AuthenticationProofError
    expect(authenticationError.code).toBe("verification_state_invalid")
    expect(authenticationError.message).not.toMatch(/authenticate|ciphertext|secret|unsupported/i)
    expect(authenticationError.cause).toBeUndefined()
    expect(audit).toBe(auditFailure)
    expect(scoped.writeDenialAudit).toHaveBeenCalledOnce()
    expect(scoped.writeDenialAudit).toHaveBeenCalledWith("verification_state_invalid")
    expect(scoped.adapter.completeAuthenticationProof).not.toHaveBeenCalled()
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
  })

  it.each([
    {
      category: "provider request rejection",
      arrange: (scoped: ReturnType<typeof dependencies>) => {
        scoped.adapter.completeAuthenticationProof.mockRejectedValueOnce(
          new Error("raw provider failure with token provider-token-secret"),
        )
      },
      rawMaterial: /provider-token-secret|raw provider failure/i,
    },
    {
      category: "mismatched provider evidence",
      arrange: (scoped: ReturnType<typeof dependencies>) => {
        scoped.adapter.completeAuthenticationProof.mockResolvedValueOnce({
          provider: "oidc",
          issuer: "https://provider-response-secret.example.test",
          subject: "provider-response-secret",
        })
      },
      rawMaterial: /provider-response-secret/i,
    },
  ])("returns a safe provider failure for $category", async ({ arrange, rawMaterial }) => {
    const scoped = dependencies()
    arrange(scoped)

    const error = await completeAuthenticationProof(
      {
        browserBinding: "browser-binding-value-with-required-length",
        code: "authorization-code",
        state: "state-value-with-the-required-minimum-length",
      },
      scoped,
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AuthenticationProofError)
    const authenticationError = error as AuthenticationProofError
    expect(authenticationError.code).toBe("provider_failed")
    expect(authenticationError.message).not.toMatch(rawMaterial)
    expect(authenticationError.cause).toBeUndefined()
    expect(scoped.writeDenialAudit).toHaveBeenCalledOnce()
    expect(scoped.writeDenialAudit).toHaveBeenCalledWith("provider_failed")
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
  })

  it.each([
    {
      category: "provider request rejection",
      arrange: (scoped: ReturnType<typeof dependencies>) => {
        scoped.adapter.completeAuthenticationProof.mockRejectedValueOnce(
          new Error("raw provider failure with token provider-token-secret"),
        )
      },
      rawMaterial: /provider-token-secret|raw provider failure/i,
    },
    {
      category: "mismatched provider evidence",
      arrange: (scoped: ReturnType<typeof dependencies>) => {
        scoped.adapter.completeAuthenticationProof.mockResolvedValueOnce({
          provider: "oidc",
          issuer: "https://provider-response-secret.example.test",
          subject: "provider-response-secret",
        })
      },
      rawMaterial: /provider-response-secret/i,
    },
  ])("preserves safe $category denial when its audit fails", async ({ arrange, rawMaterial }) => {
    const scoped = dependencies()
    const auditFailure = new Error("audit unavailable")
    arrange(scoped)
    scoped.writeDenialAudit.mockRejectedValueOnce(auditFailure)

    const error = await completeAuthenticationProof(
      {
        browserBinding: "browser-binding-value-with-required-length",
        code: "authorization-code",
        state: "state-value-with-the-required-minimum-length",
      },
      scoped,
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AggregateError)
    const [primary, audit] = (error as AggregateError).errors as [Error, Error]
    expect(primary).toBeInstanceOf(AuthenticationProofError)
    const authenticationError = primary as AuthenticationProofError
    expect(authenticationError.code).toBe("provider_failed")
    expect(authenticationError.message).not.toMatch(rawMaterial)
    expect(authenticationError.cause).toBeUndefined()
    expect((error as AggregateError).message).not.toMatch(rawMaterial)
    expect(audit).toBe(auditFailure)
    expect(scoped.writeDenialAudit).toHaveBeenCalledOnce()
    expect(scoped.writeDenialAudit).toHaveBeenCalledWith("provider_failed")
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
  })

  it("supports authoritative record loading through the two proof references", async () => {
    function loadRecords(proof: AuthenticationProofResult) {
      return {
        identity: proof.externalIdentityId,
        attempt: proof.authorizationAttemptId,
      }
    }
    const result = await completeAuthenticationProof(
      {
        browserBinding: "browser-binding-value-with-required-length",
        code: "authorization-code",
        state: "state-value-with-the-required-minimum-length",
      },
      dependencies(),
    )

    expect(loadRecords(result.proof)).toEqual({
      identity: "00000000-0000-4000-8000-000000000012",
      attempt: "00000000-0000-4000-8000-000000000010",
    })
  })

  it("accepts OIDC-like proof with no presentation attributes", async () => {
    const scoped = dependencies()
    scoped.adapter.providerKey = "oidc"
    scoped.adapter.completeAuthenticationProof.mockResolvedValueOnce({
      provider: "oidc",
      issuer: "https://id.example.test",
      subject: "person-456",
    })

    const result = await completeAuthenticationProof(
      {
        browserBinding: "browser-binding-value-with-required-length",
        code: "authorization-code",
        state: "state-value-with-the-required-minimum-length",
      },
      scoped,
    )

    expect(scoped.resolveOrCreateIdentity).toHaveBeenCalledWith({
      provider: "oidc",
      issuer: "https://id.example.test",
      subject: "person-456",
    })
    expect(result.proof).toEqual({
      authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
      externalIdentityId: "00000000-0000-4000-8000-000000000012",
    })
  })
})
