import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { consumeAuthorizationAttempt } from "."

async function createProviderRevision() {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  await prisma.$transaction(async (transaction) => {
    await transaction.authenticationProvider.create({
      data: { id: providerId, key: "github" },
    })
    await transaction.authenticationProviderRevision.create({
      data: {
        id: providerRevisionId,
        providerId,
        revision: 1,
        configurationDigest: "a".repeat(64),
      },
    })
    await transaction.authenticationProvider.update({
      where: { id: providerId },
      data: { selectedRevisionId: providerRevisionId },
    })
  })
  return providerRevisionId
}

describe("consumeAuthorizationAttempt()", () => {
  it("does not burn a wrong binding, then consumes the matching attempt once", async () => {
    const providerRevisionId = await createProviderRevision()
    const id = randomUUID()
    const stateDigest = "c".repeat(64)
    const browserBindingDigest = "d".repeat(64)
    await prisma.authorizationAttempt.create({
      data: {
        id,
        providerRevisionId,
        stateDigest,
        browserBindingDigest,
        codeVerifierCiphertext: "encrypted-verifier",
        expiresAt: new Date("2099-01-01T00:00:00Z"),
      },
    })

    await expect(
      consumeAuthorizationAttempt(prisma, {
        stateDigest,
        browserBindingDigest: "e".repeat(64),
      }),
    ).resolves.toBeNull()
    await expect(
      prisma.authorizationAttempt.findUniqueOrThrow({
        where: { id },
        select: { consumedAt: true },
      }),
    ).resolves.toEqual({ consumedAt: null })

    await expect(
      consumeAuthorizationAttempt(prisma, { stateDigest, browserBindingDigest }),
    ).resolves.toEqual({
      id,
      providerRevisionId,
      codeVerifierCiphertext: "encrypted-verifier",
    })
    await expect(
      consumeAuthorizationAttempt(prisma, { stateDigest, browserBindingDigest }),
    ).resolves.toBeNull()
  })

  it("leaves an already-expired attempt unconsumed", async () => {
    const providerRevisionId = await createProviderRevision()
    const id = randomUUID()
    const stateDigest = "f".repeat(64)
    const browserBindingDigest = "0".repeat(64)
    await prisma.$executeRaw`
      INSERT INTO "authorization_attempts" (
        "id",
        "provider_revision_id",
        "state_digest",
        "browser_binding_digest",
        "code_verifier_ciphertext",
        "expires_at",
        "created_at",
        "updated_at"
      ) VALUES (
        ${id}::uuid,
        ${providerRevisionId}::uuid,
        ${stateDigest},
        ${browserBindingDigest},
        'encrypted-verifier',
        clock_timestamp() - interval '1 second',
        clock_timestamp() - interval '2 minutes',
        clock_timestamp() - interval '2 minutes'
      )
    `

    await expect(
      consumeAuthorizationAttempt(prisma, { stateDigest, browserBindingDigest }),
    ).resolves.toBeNull()
    await expect(
      prisma.authorizationAttempt.findUniqueOrThrow({
        where: { id },
        select: { consumedAt: true },
      }),
    ).resolves.toEqual({ consumedAt: null })
  })
})
