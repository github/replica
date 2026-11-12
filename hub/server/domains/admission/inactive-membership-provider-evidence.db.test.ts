import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { admitAuthenticationProof } from "./admit-authentication-proof"
import { restoreHubSession } from "./restore-hub-session"
import { runAdmissionTransaction } from "./run-admission-transaction"
import { runSessionRestoreTransaction } from "./run-session-restore-transaction"

const initialEvidenceAt = new Date("2026-11-05T12:00:00Z")
const currentEvidenceAt = new Date("2026-11-05T12:01:00Z")

async function createInactiveMembership(lifecycle: "REMOVED" | "SUSPENDED") {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  const oldSessionDigest = randomBytes(32).toString("hex")
  await prisma.$transaction(async (transaction) => {
    await transaction.authenticationProvider.create({
      data: { id: providerId, key: "entra" },
    })
    await transaction.authenticationProviderRevision.create({
      data: {
        configurationDigest: "a".repeat(64),
        id: providerRevisionId,
        providerId,
        revision: 1,
      },
    })
    await transaction.authenticationProvider.update({
      data: { selectedRevisionId: providerRevisionId },
      where: { id: providerId },
    })
    await transaction.user.create({ data: { id: userId } })
    await transaction.externalIdentity.create({
      data: {
        id: externalIdentityId,
        issuer: "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0",
        provider: "entra",
        subject: "inactive-membership-subject",
        userId,
      },
    })
    await transaction.membership.create({
      data: { id: membershipId, lifecycle, userId },
    })
    await transaction.membershipAssignment.create({
      data: {
        externalIdentityId,
        id: randomUUID(),
        membershipId,
        providerAssignmentSubject: "22222222-2222-4222-8222-222222222222",
        providerRevisionId,
        role: "ADMINISTRATOR",
        source: "AUTHENTICATION_PROVIDER",
      },
    })
    await transaction.providerEvidenceState.create({
      data: {
        externalIdentityId,
        id: randomUUID(),
        lastIssuedAt: initialEvidenceAt,
      },
    })
    await transaction.hubSession.create({
      data: {
        digest: oldSessionDigest,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        id: randomUUID(),
        membershipId,
        revocationRevision: 0,
      },
    })
  })
  return {
    externalIdentityId,
    membershipId,
    oldSessionDigest,
    providerRevisionId,
  }
}

async function createAttempt(providerRevisionId: string) {
  return prisma.authorizationAttempt.create({
    data: {
      browserBindingDigest: randomBytes(32).toString("hex"),
      codeVerifierCiphertext: "encrypted-verifier",
      consumedAt: new Date("2026-11-05T12:00:00Z"),
      createdAt: new Date("2026-11-05T11:59:00Z"),
      expiresAt: new Date("2099-01-01T00:00:00Z"),
      id: randomUUID(),
      nonceCiphertext: "encrypted-nonce",
      providerRevisionId,
      sessionRevocationRevision: 0,
      purpose: "SIGN_IN",
      stateDigest: randomBytes(32).toString("hex"),
      updatedAt: new Date("2026-11-05T12:00:00Z"),
    },
    select: { id: true },
  })
}

async function admitProviderEvidence(
  records: Awaited<ReturnType<typeof createInactiveMembership>>,
  input: {
    issuedAt: Date
    role: "ADMINISTRATOR" | "MEMBER" | null
  },
) {
  const attempt = await createAttempt(records.providerRevisionId)
  return admitAuthenticationProof(
    {
      proof: {
        authorizationAttemptId: attempt.id,
        externalIdentityId: records.externalIdentityId,
      },
      providerAssignment: {
        assignmentSubject: input.role === null ? null : "22222222-2222-4222-8222-222222222222",
        issuedAt: input.issuedAt,
        providerRevisionId: records.providerRevisionId,
        role: input.role,
      },
      providerKey: "entra",
      requiresProviderAssignmentEvidence: true,
      sessionDigest: randomBytes(32).toString("hex"),
      sessionId: randomUUID(),
      sessionLifetimeSeconds: 3_600,
    },
    {
      createId: randomUUID,
      getBootstrapSecretDigest: () => "f".repeat(64),
      runTransaction: (operation) => runAdmissionTransaction(prisma, operation),
      writeAudit: (event) => createSecurityAudit(prisma, event),
    },
  )
}

describe("inactive membership provider evidence", () => {
  it.each([
    {
      lifecycle: "SUSPENDED" as const,
      role: "MEMBER" as const,
    },
    {
      lifecycle: "REMOVED" as const,
      role: null,
    },
  ])(
    "applies current $role evidence while the membership is $lifecycle without reactivating it",
    async ({ lifecycle, role }) => {
      const records = await createInactiveMembership(lifecycle)

      await expect(
        admitProviderEvidence(records, { issuedAt: currentEvidenceAt, role }),
      ).rejects.toMatchObject({ reason: "membership_inactive" })

      await expect(
        prisma.membership.findUniqueOrThrow({
          select: { lifecycle: true },
          where: { id: records.membershipId },
        }),
      ).resolves.toEqual({ lifecycle })
      await expect(
        prisma.providerEvidenceState.findUniqueOrThrow({
          select: { lastIssuedAt: true },
          where: { externalIdentityId: records.externalIdentityId },
        }),
      ).resolves.toEqual({ lastIssuedAt: currentEvidenceAt })
      const assignments = await prisma.membershipAssignment.findMany({
        orderBy: { createdAt: "asc" },
        select: { lifecycle: true, role: true },
        where: { membershipId: records.membershipId },
      })
      expect(assignments).toEqual(
        role === null
          ? [{ lifecycle: "REVOKED", role: "ADMINISTRATOR" }]
          : [
              { lifecycle: "SUPERSEDED", role: "ADMINISTRATOR" },
              { lifecycle: "ACTIVE", role: "MEMBER" },
            ],
      )
      const endedSessions = await prisma.hubSession.findMany({
        select: { endedAt: true },
        where: { membershipId: records.membershipId },
      })
      expect(endedSessions).toHaveLength(1)
      expect(endedSessions[0]?.endedAt).toBeInstanceOf(Date)
      await expect(
        restoreHubSession(records.oldSessionDigest, {
          runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
        }),
      ).resolves.toBeNull()
    },
  )
})
