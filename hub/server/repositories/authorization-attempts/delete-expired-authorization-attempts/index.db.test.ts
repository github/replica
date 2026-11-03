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
          "code_verifier_ciphertext", "expires_at", "consumed_at", "created_at", "updated_at"
        ) VALUES
          (
            ${unconsumedId}::uuid, ${providerRevisionId}::uuid, ${"1".repeat(64)},
            ${"2".repeat(64)}, 'unconsumed', CURRENT_TIMESTAMP - interval '1 minute',
            NULL, CURRENT_TIMESTAMP - interval '11 minutes', CURRENT_TIMESTAMP - interval '11 minutes'
          ),
          (
            ${consumedId}::uuid, ${providerRevisionId}::uuid, ${"3".repeat(64)},
            ${"4".repeat(64)}, 'consumed', CURRENT_TIMESTAMP - interval '1 minute',
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

  it("deletes consumed attempts at the fixed ten-minute retention boundary", async () => {
    const providerRevisionId = await createProviderRevision()
    const boundaryId = randomUUID()

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        INSERT INTO "authorization_attempts" (
          "id", "provider_revision_id", "state_digest", "browser_binding_digest",
          "code_verifier_ciphertext", "expires_at", "consumed_at", "created_at", "updated_at"
        ) VALUES (
          ${boundaryId}::uuid,
          ${providerRevisionId}::uuid,
          ${"5".repeat(64)},
          ${"6".repeat(64)},
          'boundary',
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
          "code_verifier_ciphertext", "expires_at", "created_at", "updated_at"
        ) VALUES (
          ${id}::uuid,
          ${providerRevisionId}::uuid,
          ${"7".repeat(64)},
          ${"8".repeat(64)},
          'unexpired',
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
})
