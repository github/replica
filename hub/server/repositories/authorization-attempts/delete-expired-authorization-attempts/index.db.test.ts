import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { deleteExpiredAuthorizationAttempts } from "."

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

describe("deleteExpiredAuthorizationAttempts()", () => {
  it("deletes unconsumed expiry while retaining a recently consumed attempt", async () => {
    const providerRevisionId = await createProviderRevision()
    const unconsumedId = randomUUID()
    const consumedId = randomUUID()

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        INSERT INTO "authorization_attempts" (
          "id", "provider_revision_id", "state_digest", "browser_binding_digest",
          "purpose", "code_verifier_ciphertext", "session_revocation_revision",
          "expires_at", "consumed_at", "created_at", "updated_at"
        ) VALUES
          (
            ${unconsumedId}::uuid, ${providerRevisionId}::uuid, ${"1".repeat(64)},
            ${"2".repeat(64)}, 'SIGN_IN', 'unconsumed', 0,
            CURRENT_TIMESTAMP - interval '1 minute',
            NULL, CURRENT_TIMESTAMP - interval '11 minutes', CURRENT_TIMESTAMP - interval '11 minutes'
          ),
          (
            ${consumedId}::uuid, ${providerRevisionId}::uuid, ${"3".repeat(64)},
            ${"4".repeat(64)}, 'SIGN_IN', 'consumed', 0,
            CURRENT_TIMESTAMP - interval '1 minute',
            CURRENT_TIMESTAMP - interval '1 minute 1 millisecond',
            CURRENT_TIMESTAMP - interval '11 minutes', CURRENT_TIMESTAMP - interval '1 minute'
          )
      `

      await deleteExpiredAuthorizationAttempts(transaction)

      await expect(
        transaction.authorizationAttempt.findUnique({ where: { id: unconsumedId } }),
      ).resolves.toBeNull()
      await expect(
        transaction.authorizationAttempt.findUnique({ where: { id: consumedId } }),
      ).resolves.toMatchObject({
        id: consumedId,
        codeVerifierCiphertext: "consumed",
      })
    })
  })

  it("uses one transaction-stable cutoff for cleanup and deletion protection", async () => {
    const providerRevisionId = await createProviderRevision()
    const id = randomUUID()

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        INSERT INTO "authorization_attempts" (
          "id", "provider_revision_id", "state_digest", "browser_binding_digest",
          "purpose", "code_verifier_ciphertext", "session_revocation_revision",
          "expires_at", "created_at", "updated_at"
        ) VALUES (
          ${id}::uuid,
          ${providerRevisionId}::uuid,
          ${"b".repeat(64)},
          ${"c".repeat(64)},
          'SIGN_IN',
          'transaction-stable-cutoff',
          0,
          CURRENT_TIMESTAMP + interval '1 millisecond',
          CURRENT_TIMESTAMP - interval '1 minute',
          CURRENT_TIMESTAMP - interval '1 minute'
        )
      `
      await transaction.$executeRaw`SELECT pg_sleep(0.05)`
      const [timing] = await transaction.$queryRaw<Array<{ clockNow: Date; expiresAt: Date }>>`
        SELECT clock_timestamp() AS "clockNow", "expires_at" AS "expiresAt"
        FROM "authorization_attempts"
        WHERE "id" = ${id}::uuid
      `
      expect(timing?.clockNow.getTime()).toBeGreaterThan(timing?.expiresAt.getTime() ?? Infinity)

      await deleteExpiredAuthorizationAttempts(transaction)

      await expect(
        transaction.authorizationAttempt.findUnique({ where: { id } }),
      ).resolves.toMatchObject({ id })
    })

    await prisma.$transaction((transaction) => deleteExpiredAuthorizationAttempts(transaction))

    await expect(prisma.authorizationAttempt.findUnique({ where: { id } })).resolves.toBeNull()
  })

  it("deletes consumed attempts at the fixed ten-minute retention boundary", async () => {
    const providerRevisionId = await createProviderRevision()
    const boundaryId = randomUUID()

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        INSERT INTO "authorization_attempts" (
          "id", "provider_revision_id", "state_digest", "browser_binding_digest",
          "purpose", "code_verifier_ciphertext", "session_revocation_revision",
          "expires_at", "consumed_at", "created_at", "updated_at"
        ) VALUES (
          ${boundaryId}::uuid,
          ${providerRevisionId}::uuid,
          ${"5".repeat(64)},
          ${"6".repeat(64)},
          'SIGN_IN',
          'boundary',
          0,
          CURRENT_TIMESTAMP - interval '11 minutes',
          date_trunc('milliseconds', CURRENT_TIMESTAMP - interval '10 minutes'),
          CURRENT_TIMESTAMP - interval '12 minutes',
          date_trunc('milliseconds', CURRENT_TIMESTAMP - interval '10 minutes')
        )
      `

      await deleteExpiredAuthorizationAttempts(transaction)

      await expect(
        transaction.authorizationAttempt.findUnique({ where: { id: boundaryId } }),
      ).resolves.toBeNull()
    })
  })

  it("rejects manual deletion before an unconsumed attempt expires", async () => {
    const providerRevisionId = await createProviderRevision()
    const id = randomUUID()

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        INSERT INTO "authorization_attempts" (
          "id", "provider_revision_id", "state_digest", "browser_binding_digest",
          "purpose", "code_verifier_ciphertext", "session_revocation_revision",
          "expires_at", "created_at", "updated_at"
        ) VALUES (
          ${id}::uuid,
          ${providerRevisionId}::uuid,
          ${"7".repeat(64)},
          ${"8".repeat(64)},
          'SIGN_IN',
          'unexpired',
          0,
          CURRENT_TIMESTAMP + interval '1 second',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `

      await expect(transaction.authorizationAttempt.delete({ where: { id } })).rejects.toThrow(
        "Unexpired authorization attempts cannot be deleted.",
      )
    })
  })

  it("rejects manual deletion before consumed retention elapses", async () => {
    const providerRevisionId = await createProviderRevision()
    const id = randomUUID()

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        INSERT INTO "authorization_attempts" (
          "id", "provider_revision_id", "state_digest", "browser_binding_digest",
          "purpose", "code_verifier_ciphertext", "session_revocation_revision",
          "expires_at", "consumed_at", "created_at", "updated_at"
        ) VALUES (
          ${id}::uuid,
          ${providerRevisionId}::uuid,
          ${"9".repeat(64)},
          ${"a".repeat(64)},
          'SIGN_IN',
          'recently-consumed',
          0,
          CURRENT_TIMESTAMP - interval '1 minute',
          CURRENT_TIMESTAMP - interval '9 minutes',
          CURRENT_TIMESTAMP - interval '11 minutes',
          CURRENT_TIMESTAMP - interval '9 minutes'
        )
      `

      await expect(transaction.authorizationAttempt.delete({ where: { id } })).rejects.toThrow(
        "Recently consumed authorization attempts cannot be deleted.",
      )
    })
  })
})
