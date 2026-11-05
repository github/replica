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
const newerEvidenceAt = new Date("2026-11-05T12:02:00Z")

async function createInactiveMembership(lifecycle: "REMOVED" | "SUSPENDED") {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  const assignmentId = randomUUID()
  const oldSessionDigests = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex")]
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
        id: assignmentId,
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
    for (const digest of oldSessionDigests) {
      await transaction.hubSession.create({
        data: {
          digest,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          id: randomUUID(),
          membershipId,
          revocationRevision: 0,
        },
      })
    }
  })
  return {
    assignmentId,
    externalIdentityId,
    membershipId,
    oldSessionDigests,
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
      staleEvidenceAt: currentEvidenceAt,
    },
    {
      lifecycle: "REMOVED" as const,
      role: null,
      staleEvidenceAt: initialEvidenceAt,
    },
  ])(
    "applies current $role evidence while the membership is $lifecycle without reactivating it",
    async ({ lifecycle, role, staleEvidenceAt }) => {
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
          : expect.arrayContaining([
              { lifecycle: "SUPERSEDED", role: "ADMINISTRATOR" },
              { lifecycle: "ACTIVE", role: "MEMBER" },
            ]),
      )
      const retainedSessions = await prisma.hubSession.findMany({
        select: { endedAt: true },
        where: { membershipId: records.membershipId },
      })
      expect(retainedSessions).toHaveLength(2)
      expect(retainedSessions.every(({ endedAt }) => endedAt instanceof Date)).toBe(true)
      for (const digest of records.oldSessionDigests) {
        await expect(
          restoreHubSession(digest, {
            runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
          }),
        ).resolves.toBeNull()
      }

      await prisma.membership.update({
        data: { lifecycle: "ACTIVE" },
        where: { id: records.membershipId },
      })
      await expect(
        admitProviderEvidence(records, { issuedAt: staleEvidenceAt, role: "ADMINISTRATOR" }),
      ).rejects.toMatchObject({ reason: "provider_evidence_stale" })
      await expect(
        prisma.providerEvidenceState.findUniqueOrThrow({
          select: { lastIssuedAt: true },
          where: { externalIdentityId: records.externalIdentityId },
        }),
      ).resolves.toEqual({ lastIssuedAt: currentEvidenceAt })

      const currentAdmission = admitProviderEvidence(records, {
        issuedAt: newerEvidenceAt,
        role,
      })
      if (role === null) {
        await expect(currentAdmission).rejects.toMatchObject({ reason: "authority_missing" })
        await expect(prisma.hubSession.count()).resolves.toBe(2)
      } else {
        await expect(currentAdmission).resolves.toMatchObject({ role: "MEMBER" })
        await expect(prisma.hubSession.count()).resolves.toBe(3)
      }
      await expect(
        prisma.membershipAssignment.findFirst({
          select: { role: true },
          where: {
            lifecycle: "ACTIVE",
            membershipId: records.membershipId,
            source: "AUTHENTICATION_PROVIDER",
          },
        }),
      ).resolves.toEqual(role === null ? null : { role })
    },
  )
})
