import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { completeAuthenticationProof } from "."

describe("completeAuthenticationProof()", () => {
  it("consumes the attempt before provider work and returns only a pending handoff", async () => {
    const order: string[] = []
    const createHandoff = vi.fn(() => {
      order.push("handoff")
      return Promise.resolve({ status: "created" as const })
    })
    const result = await completeAuthenticationProof(
      {
        browserBinding: "browser-binding-value-with-required-length",
        code: "authorization-code",
        state: "state-value-with-the-required-minimum-length",
      },
      {
        adapter: {
          providerKey: "github",
          createAuthorizationUrl: vi.fn(),
          completeAuthenticationProof: (input) => {
            order.push("provider")
            expect(input.codeVerifier).toBe("pkce-verifier")
            return Promise.resolve({
              provider: "github",
              issuer: "https://github.com",
              subject: "123",
              attributes: {
                login: "octocat",
                name: null,
                avatarUrl: null,
                email: null,
              },
            })
          },
        },
        callbackUri: "https://hub.test/callback",
        consumeAttempt: () => {
          order.push("consume")
          return Promise.resolve({
            providerRevisionId: "00000000-0000-4000-8000-000000000011",
            codeVerifierCiphertext: "encrypted-verifier",
          })
        },
        createHandoff,
        createOpaqueValue: () => "handoff-secret",
        decryptCodeVerifier: () => "pkce-verifier",
        getSelectedProviderRevision: () =>
          Promise.resolve({
            id: "00000000-0000-4000-8000-000000000011",
            revision: 1,
            configurationDigest: "a".repeat(64),
          }),
        getRevocationGeneration: () => Promise.resolve(1n),
        now: () => new Date("2026-10-30T16:00:00Z"),
        resolveOrCreateIdentity: () => {
          order.push("identity")
          return Promise.resolve({
            externalIdentityId: "00000000-0000-4000-8000-000000000012",
            userId: "00000000-0000-4000-8000-000000000013",
          })
        },
        writeDenialAudit: vi.fn(),
      },
    )

    expect(order).toEqual(["consume", "provider", "identity", "handoff"])
    expect(result).toMatchObject({
      status: "authentication_proved",
      handoffToken: "handoff-secret",
    })
    expect(createHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenDigest: createHash("sha256").update("handoff-secret").digest("hex"),
      }),
    )
    expect(result).not.toHaveProperty("userId")
    expect(result).not.toHaveProperty("session")
  })

  it("does not call the provider for replayed or browser-mismatched attempts", async () => {
    const completeProvider = vi.fn()
    await expect(
      completeAuthenticationProof(
        {
          browserBinding: "browser-binding-value-with-required-length",
          code: "authorization-code",
          state: "state-value-with-the-required-minimum-length",
        },
        {
          adapter: {
            providerKey: "github",
            createAuthorizationUrl: vi.fn(),
            completeAuthenticationProof: completeProvider,
          },
          callbackUri: "https://hub.test/callback",
          consumeAttempt: () => Promise.resolve(null),
          createHandoff: vi.fn(),
          createOpaqueValue: vi.fn(),
          decryptCodeVerifier: vi.fn(),
          getSelectedProviderRevision: vi.fn(),
          getRevocationGeneration: vi.fn(),
          now: () => new Date(),
          resolveOrCreateIdentity: vi.fn(),
          writeDenialAudit: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ code: "attempt_invalid" })
    expect(completeProvider).not.toHaveBeenCalled()
  })

  it("keeps a consumed attempt consumed when the bounded provider request fails", async () => {
    const consumeAttempt = vi.fn(() =>
      Promise.resolve({
        providerRevisionId: "00000000-0000-4000-8000-000000000011",
        codeVerifierCiphertext: "encrypted-verifier",
      }),
    )
    const createHandoff = vi.fn()

    await expect(
      completeAuthenticationProof(
        {
          browserBinding: "browser-binding-value-with-required-length",
          code: "authorization-code",
          state: "state-value-with-the-required-minimum-length",
        },
        {
          adapter: {
            providerKey: "github",
            createAuthorizationUrl: vi.fn(),
            completeAuthenticationProof: () =>
              Promise.reject(new Error("bounded provider failure")),
          },
          callbackUri: "https://hub.test/callback",
          consumeAttempt,
          createHandoff,
          createOpaqueValue: vi.fn(),
          decryptCodeVerifier: () => "pkce-verifier",
          getSelectedProviderRevision: () =>
            Promise.resolve({
              id: "00000000-0000-4000-8000-000000000011",
              revision: 1,
              configurationDigest: "a".repeat(64),
            }),
          getRevocationGeneration: vi.fn(),
          now: () => new Date(),
          resolveOrCreateIdentity: vi.fn(),
          writeDenialAudit: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ code: "provider_failed" })
    expect(consumeAttempt).toHaveBeenCalledOnce()
    expect(createHandoff).not.toHaveBeenCalled()
  })
})
