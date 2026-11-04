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
  const consumeAttempt = vi.fn<CompleteAuthenticationProofDependencies["consumeAttempt"]>(() =>
    Promise.resolve({
      id: "00000000-0000-4000-8000-000000000010",
      providerRevisionId: revision.id,
      codeVerifierCiphertext: "encrypted-verifier",
      nonceCiphertext: "encrypted-nonce",
      createdAt: new Date("2026-11-04T18:00:00Z"),
      requiresFreshAuthentication: false,
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
    decryptNonce: vi.fn(() => "nonce-value"),
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

  it("passes the saved attempt start only when fresh authentication was required", async () => {
    const scoped = dependencies()
    scoped.consumeAttempt.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000010",
      providerRevisionId: revision.id,
      codeVerifierCiphertext: "encrypted-verifier",
      nonceCiphertext: "encrypted-nonce",
      createdAt: new Date("2026-11-04T18:00:00Z"),
      requiresFreshAuthentication: true,
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
        requiresFreshAuthentication: false,
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

  it("rejects missing or undecryptable nonce state before provider work", async () => {
    const scoped = dependencies()
    scoped.consumeAttempt.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000010",
      providerRevisionId: revision.id,
      codeVerifierCiphertext: "encrypted-verifier",
      nonceCiphertext: null,
      createdAt: new Date(),
      requiresFreshAuthentication: false,
    })

    await expect(completeAuthenticationProof(input, scoped)).rejects.toMatchObject({
      code: "verification_state_invalid",
    })
    expect(scoped.adapter.completeAuthenticationProof).not.toHaveBeenCalled()
  })

  it("fails closed when the provider revision changes after provider proof", async () => {
    const scoped = dependencies()
    scoped.getSelectedProviderRevision
      .mockResolvedValueOnce(revision)
      .mockResolvedValueOnce({ ...revision, configurationDigest: "b".repeat(64) })

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
})
