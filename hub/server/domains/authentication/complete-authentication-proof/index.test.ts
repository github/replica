import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { AuthenticationProofError } from "../errors"
import type { AuthenticationProviderAdapter } from "../types"
import type { CompleteAuthenticationProofDependencies } from "./types"
import { completeAuthenticationProof } from "."

const revision = {
  id: "00000000-0000-4000-8000-000000000011",
  revision: 1,
  configurationDigest: "a".repeat(64),
}

function dependencies() {
  const completeProvider = vi.fn<AuthenticationProviderAdapter["completeAuthenticationProof"]>(() =>
    Promise.resolve({
      identity: {
        provider: "github",
        issuer: "https://github.com",
        subject: "123",
      },
    }),
  )
  const consumeAttempt = vi.fn<CompleteAuthenticationProofDependencies["consumeAttempt"]>(() => {
    const attempt = {
      id: "00000000-0000-4000-8000-000000000010",
      providerRevisionId: revision.id,
      codeVerifierCiphertext: "encrypted-verifier",
      nonceCiphertext: "encrypted-nonce",
      createdAt: new Date("2026-11-04T18:00:00Z"),
      purpose: "SIGN_IN",
      sessionRevocationRevision: 0,
    } as const
    return Promise.resolve(attempt)
  })
  return {
    adapter: {
      providerKey: "github",
      createAuthorizationUrl: vi.fn(),
      completeAuthenticationProof: completeProvider,
    },
    callbackUri: "https://hub.example.test/api/auth/github/callback",
    consumeAttempt,
    decryptCodeVerifier: vi.fn(() => "pkce-verifier"),
    decryptNonce: vi.fn(() => "nonce-value"),
    localConfigurationDigest: revision.configurationDigest,
    localRevision: revision.revision,
    getAuthenticationProofState: vi.fn(() =>
      Promise.resolve({
        selectedProviderRevision: revision,
        sessionRevocationRevision: 0,
      }),
    ),
    resolveOrCreateIdentity: vi.fn(() =>
      Promise.resolve({
        externalIdentityId: "00000000-0000-4000-8000-000000000012",
        userId: "00000000-0000-4000-8000-000000000013",
      }),
    ),
    writeDenialAudit: vi.fn(() => Promise.resolve()),
  } satisfies CompleteAuthenticationProofDependencies
}

const input = {
  browserBinding: "browser-binding-value-with-required-length",
  code: "authorization-code",
  state: "state-value-with-the-required-minimum-length",
}

describe("completeAuthenticationProof()", () => {
  it("passes attempt-bound verification values and returns only bounded proof references", async () => {
    const scoped = dependencies()

    const result = await completeAuthenticationProof(input, scoped)

    expect(scoped.consumeAttempt).toHaveBeenCalledWith({
      browserBindingDigest: createHash("sha256").update(input.browserBinding).digest("hex"),
      stateDigest: createHash("sha256").update(input.state).digest("hex"),
    })
    expect(scoped.adapter.completeAuthenticationProof).toHaveBeenCalledWith({
      authenticatedAfter: undefined,
      callbackUri: scoped.callbackUri,
      code: input.code,
      codeVerifier: "pkce-verifier",
      nonce: "nonce-value",
    })
    expect(scoped.resolveOrCreateIdentity).toHaveBeenCalledWith({
      authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
      issuer: "https://github.com",
      provider: "github",
      providerRevisionId: revision.id,
      sessionRevocationRevision: 0,
      subject: "123",
    })
    expect(result).toEqual({
      proof: {
        authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
        externalIdentityId: "00000000-0000-4000-8000-000000000012",
      },
    })
    expect(Object.keys(result.proof).sort()).toEqual([
      "authorizationAttemptId",
      "externalIdentityId",
    ])
  })

  it("passes the saved attempt start only for administrator enrollment", async () => {
    const scoped = dependencies()
    scoped.consumeAttempt.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000010",
      providerRevisionId: revision.id,
      codeVerifierCiphertext: "encrypted-verifier",
      nonceCiphertext: "encrypted-nonce",
      createdAt: new Date("2026-11-04T18:00:00Z"),
      purpose: "ADMIN_ENROLLMENT",
      sessionRevocationRevision: 0,
    })

    await completeAuthenticationProof(input, scoped)

    expect(scoped.adapter.completeAuthenticationProof).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedAfter: new Date("2026-11-04T18:00:00Z"),
      }),
    )
  })

  it("keeps provider assignment evidence separate from the C2 proof", async () => {
    const scoped = dependencies()
    scoped.adapter.providerKey = "entra"
    scoped.adapter.completeAuthenticationProof.mockResolvedValueOnce({
      identity: {
        provider: "entra",
        issuer: "https://login.microsoftonline.com/tenant/v2.0",
        subject: "immutable-subject",
      },
      providerAssignment: {
        assignmentSubject: "11111111-1111-4111-8111-111111111111",
        issuedAt: new Date("2026-11-04T18:00:00Z"),
        role: "ADMINISTRATOR",
      },
    })

    const result = await completeAuthenticationProof(input, scoped)

    expect(result).toEqual({
      proof: {
        authorizationAttemptId: "00000000-0000-4000-8000-000000000010",
        externalIdentityId: "00000000-0000-4000-8000-000000000012",
      },
      providerAssignment: {
        assignmentSubject: "11111111-1111-4111-8111-111111111111",
        issuedAt: new Date("2026-11-04T18:00:00Z"),
        providerRevisionId: revision.id,
        role: "ADMINISTRATOR",
      },
    })
    expect(result.proof).not.toHaveProperty("providerAssignment")
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
        nonceCiphertext: "encrypted-nonce",
        createdAt: new Date(),
        purpose: "SIGN_IN",
        sessionRevocationRevision: 0,
      })
    })
    scoped.adapter.completeAuthenticationProof.mockImplementation(() => {
      order.push("provider")
      return Promise.resolve({
        identity: {
          provider: "github",
          issuer: "https://github.com",
          subject: "123",
        },
      })
    })

    await completeAuthenticationProof(input, scoped)

    expect(order).toEqual(["consume", "provider"])
  })

  it("rejects replay before provider work", async () => {
    const scoped = dependencies()
    scoped.consumeAttempt.mockResolvedValueOnce(null)

    await expect(completeAuthenticationProof(input, scoped)).rejects.toMatchObject({
      code: "attempt_invalid",
    })
    expect(scoped.adapter.completeAuthenticationProof).not.toHaveBeenCalled()
    expect(scoped.writeDenialAudit).toHaveBeenCalledWith("invalid_or_expired")
  })

  it("rejects missing nonce state before provider work", async () => {
    const scoped = dependencies()
    scoped.consumeAttempt.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000010",
      providerRevisionId: revision.id,
      codeVerifierCiphertext: "encrypted-verifier",
      nonceCiphertext: null,
      createdAt: new Date(),
      purpose: "SIGN_IN",
      sessionRevocationRevision: 0,
    })

    await expect(completeAuthenticationProof(input, scoped)).rejects.toMatchObject({
      code: "verification_state_invalid",
    })
    expect(scoped.adapter.completeAuthenticationProof).not.toHaveBeenCalled()
    expect(scoped.writeDenialAudit).toHaveBeenCalledWith("verification_state_invalid")
  })

  it("rejects nonce decryption failure before provider work", async () => {
    const scoped = dependencies()
    scoped.decryptNonce.mockImplementationOnce(() => {
      throw new Error("encrypted nonce marker")
    })

    const error = await completeAuthenticationProof(input, scoped).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(AuthenticationProofError)
    expect(error).toMatchObject({ code: "verification_state_invalid" })
    expect(error).not.toHaveProperty("cause")
    expect((error as Error).message).not.toContain("encrypted nonce marker")
    expect(scoped.adapter.completeAuthenticationProof).not.toHaveBeenCalled()
    expect(scoped.writeDenialAudit).toHaveBeenCalledWith("verification_state_invalid")
  })

  it("fails closed before provider work for local configuration drift", async () => {
    const scoped = dependencies()
    scoped.localConfigurationDigest = "b".repeat(64)

    await expect(completeAuthenticationProof(input, scoped)).rejects.toMatchObject({
      code: "configuration_changed",
    })
    expect(scoped.decryptCodeVerifier).not.toHaveBeenCalled()
    expect(scoped.decryptNonce).not.toHaveBeenCalled()
    expect(scoped.adapter.completeAuthenticationProof).not.toHaveBeenCalled()
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
    expect(scoped.writeDenialAudit).toHaveBeenCalledWith("configuration_changed")
  })

  it("denies an attempt from before global revocation without calling the provider", async () => {
    const scoped = dependencies()
    scoped.getAuthenticationProofState.mockResolvedValue({
      selectedProviderRevision: revision,
      sessionRevocationRevision: 1,
    })

    await expect(completeAuthenticationProof(input, scoped)).rejects.toMatchObject({
      code: "configuration_changed",
    })
    expect(scoped.decryptCodeVerifier).not.toHaveBeenCalled()
    expect(scoped.decryptNonce).not.toHaveBeenCalled()
    expect(scoped.adapter.completeAuthenticationProof).not.toHaveBeenCalled()
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
  })

  it("fails closed when global revocation advances during provider work", async () => {
    const scoped = dependencies()
    scoped.getAuthenticationProofState
      .mockResolvedValueOnce({
        selectedProviderRevision: revision,
        sessionRevocationRevision: 0,
      })
      .mockResolvedValueOnce({
        selectedProviderRevision: revision,
        sessionRevocationRevision: 1,
      })

    await expect(completeAuthenticationProof(input, scoped)).rejects.toMatchObject({
      code: "configuration_changed",
    })
    expect(scoped.adapter.completeAuthenticationProof).toHaveBeenCalledOnce()
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
  })

  it("fails closed when the provider revision changes after provider proof", async () => {
    const scoped = dependencies()
    scoped.getAuthenticationProofState
      .mockResolvedValueOnce({
        selectedProviderRevision: revision,
        sessionRevocationRevision: 0,
      })
      .mockResolvedValueOnce({
        selectedProviderRevision: { ...revision, configurationDigest: "b".repeat(64) },
        sessionRevocationRevision: 0,
      })

    await expect(completeAuthenticationProof(input, scoped)).rejects.toMatchObject({
      code: "configuration_changed",
    })
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
  })

  it("returns a safe provider failure for rejected or mismatched evidence", async () => {
    const scoped = dependencies()
    scoped.adapter.completeAuthenticationProof.mockResolvedValueOnce({
      identity: {
        provider: "entra",
        issuer: "https://secret.example.test",
        subject: "secret-subject",
      },
    })

    const error = await completeAuthenticationProof(input, scoped).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(AuthenticationProofError)
    expect(error).toMatchObject({ code: "provider_failed" })
    expect((error as Error).message).not.toMatch(/secret/)
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
  })

  it("returns an audited safe provider failure when the adapter throws", async () => {
    const scoped = dependencies()
    scoped.adapter.completeAuthenticationProof.mockRejectedValueOnce(
      new Error("provider token secret-marker"),
    )

    const error = await completeAuthenticationProof(input, scoped).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(AuthenticationProofError)
    expect(error).toMatchObject({ code: "provider_failed" })
    expect(error).not.toHaveProperty("cause")
    expect((error as Error).message).not.toMatch(/provider token|secret-marker/)
    expect(scoped.resolveOrCreateIdentity).not.toHaveBeenCalled()
    expect(scoped.writeDenialAudit).toHaveBeenCalledWith("provider_failed")
  })
})
