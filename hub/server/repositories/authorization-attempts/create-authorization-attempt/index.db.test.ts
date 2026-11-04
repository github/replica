import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { createAuthorizationAttempt } from "."

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

describe("createAuthorizationAttempt()", () => {
  it("uses database time for creation and expiry", async () => {
    const providerRevisionId = await createProviderRevision()
    const id = randomUUID()
    vi.setSystemTime(new Date("2000-01-01T00:00:00Z"))

    const timing = await prisma.$transaction(async (transaction) => {
      const beforeRows = await transaction.$queryRaw<Array<{ value: Date }>>`
        SELECT clock_timestamp()::timestamptz(3) AS value
      `
      const result = await createAuthorizationAttempt(transaction, {
        bootstrapSecretDigest: null,
        id,
        providerRevisionId,
        stateDigest: "a".repeat(64),
        browserBindingDigest: "b".repeat(64),
        codeVerifierCiphertext: "encrypted-verifier",
        nonceCiphertext: "encrypted-nonce",
        lifetimeSeconds: 600,
        purpose: "SIGN_IN",
        requiresFreshAuthentication: false,
      })
      const afterRows = await transaction.$queryRaw<Array<{ value: Date }>>`
        SELECT clock_timestamp()::timestamptz(3) AS value
      `
      const attempt = await transaction.authorizationAttempt.findUniqueOrThrow({
        where: { id },
        select: { createdAt: true, expiresAt: true },
      })
      return {
        before: beforeRows[0]!.value,
        after: afterRows[0]!.value,
        returnedExpiry: result.expiresAt,
        ...attempt,
      }
    })

    expect(timing.createdAt.getTime()).toBeGreaterThanOrEqual(timing.before.getTime())
    expect(timing.createdAt.getTime()).toBeLessThanOrEqual(timing.after.getTime())
    expect(timing.returnedExpiry).toEqual(timing.expiresAt)
    expect(timing.expiresAt.getTime() - timing.createdAt.getTime()).toBeGreaterThan(599_000)
    expect(timing.expiresAt.getTime() - timing.createdAt.getTime()).toBeLessThanOrEqual(600_000)
  })

  it("persists an enrollment digest while leaving sign-in without one", async () => {
    const providerRevisionId = await createProviderRevision()
    const enrollmentId = randomUUID()
    const signInId = randomUUID()
    const digest = "f".repeat(64)

    await prisma.$transaction(async (transaction) => {
      await createAuthorizationAttempt(transaction, {
        bootstrapSecretDigest: digest,
        browserBindingDigest: "b".repeat(64),
        codeVerifierCiphertext: "encrypted-enrollment-verifier",
        id: enrollmentId,
        lifetimeSeconds: 600,
        providerRevisionId,
        purpose: "ADMIN_ENROLLMENT",
        stateDigest: "c".repeat(64),
      })
      await createAuthorizationAttempt(transaction, {
        bootstrapSecretDigest: null,
        browserBindingDigest: "d".repeat(64),
        codeVerifierCiphertext: "encrypted-sign-in-verifier",
        id: signInId,
        lifetimeSeconds: 600,
        providerRevisionId,
        purpose: "SIGN_IN",
        stateDigest: "e".repeat(64),
      })
    })

    await expect(
      prisma.authorizationAttempt.findMany({
        where: { id: { in: [enrollmentId, signInId] } },
        orderBy: { purpose: "asc" },
        select: { bootstrapSecretDigest: true, purpose: true },
      }),
    ).resolves.toEqual([
      { bootstrapSecretDigest: null, purpose: "SIGN_IN" },
      { bootstrapSecretDigest: digest, purpose: "ADMIN_ENROLLMENT" },
    ])
  })
})
