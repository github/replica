import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { admitAuthenticationProof } from "./admit-authentication-proof"
import { AdmissionPersistenceError } from "./errors"
import { runAdmissionTransaction } from "./run-admission-transaction"
import { withFailingSecurityAudit } from "./test/with-failing-security-audit"

describe("admission success audit rollback", () => {
  it("rolls back restored authority and session replacement when an ended-session audit fails", async () => {
    const providerId = randomUUID()
    const revisionId = randomUUID()
    const userId = randomUUID()
    const externalIdentityId = randomUUID()
    const membershipId = randomUUID()
    const assignmentId = randomUUID()
    const attemptId = randomUUID()
    const oldSessionId = randomUUID()
    const sessionId = randomUUID()
    await prisma.$transaction(async (transaction) => {
      await transaction.authenticationProvider.create({
        data: { id: providerId, key: "github" },
      })
      await transaction.authenticationProviderRevision.create({
        data: {
          id: revisionId,
          providerId,
          revision: 1,
          configurationDigest: "a".repeat(64),
        },
      })
      await transaction.authenticationProvider.update({
        where: { id: providerId },
        data: { selectedRevisionId: revisionId },
      })
      await transaction.user.create({ data: { id: userId } })
      await transaction.externalIdentity.create({
        data: {
          id: externalIdentityId,
          userId,
          provider: "github",
          issuer: "https://github.com",
          subject: "rollback-user",
        },
      })
      await transaction.membership.create({
        data: {
          id: membershipId,
          userId,
          lifecycle: "REMOVED",
        },
      })
      await transaction.membershipAssignment.create({
        data: {
          id: assignmentId,
          membershipId,
          externalIdentityId,
          source: "BOOTSTRAP",
          role: "ADMINISTRATOR",
          lifecycle: "REVOKED",
        },
      })
      await transaction.hubSession.create({
        data: {
          id: oldSessionId,
          membershipId,
          digest: "e".repeat(64),
          revocationRevision: 0,
          expiresAt: new Date("2030-01-01T00:00:00Z"),
        },
      })
      await transaction.authorizationAttempt.create({
        data: {
          bootstrapSecretDigest: "f".repeat(64),
          id: attemptId,
          providerRevisionId: revisionId,
          purpose: "ADMIN_ENROLLMENT",
          stateDigest: "b".repeat(64),
          browserBindingDigest: "c".repeat(64),
          codeVerifierCiphertext: "encrypted",
          nonceCiphertext: "encrypted-nonce",
          createdAt: new Date("2020-01-01T00:00:00Z"),
          updatedAt: new Date("2020-01-01T00:00:00Z"),
          expiresAt: new Date("2030-01-01T00:00:00Z"),
          consumedAt: new Date("2020-01-01T00:01:00Z"),
        },
      })
    })

    await withFailingSecurityAudit("session.ended", () =>
      expect(
        admitAuthenticationProof(
          {
            proof: { authorizationAttemptId: attemptId, externalIdentityId },
            providerKey: "github",
            requiresProviderAssignmentEvidence: false,
            sessionDigest: "d".repeat(64),
            sessionId,
            sessionLifetimeSeconds: 3_600,
          },
          {
            createId: randomUUID,
            getBootstrapSecretDigest: () => "f".repeat(64),
            runTransaction: (operation) => runAdmissionTransaction(prisma, operation),
            writeAudit: (event) => createSecurityAudit(prisma, event),
          },
        ),
      ).rejects.toBeInstanceOf(AdmissionPersistenceError),
    )

    expect(
      await prisma.membership.findUniqueOrThrow({
        where: { id: membershipId },
        select: { lifecycle: true },
      }),
    ).toEqual({ lifecycle: "REMOVED" })
    expect(
      await prisma.membershipAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        select: { lifecycle: true },
      }),
    ).toEqual({ lifecycle: "REVOKED" })
    expect(
      await prisma.hubSession.findMany({
        orderBy: { id: "asc" },
        select: { id: true, endedAt: true },
      }),
    ).toEqual([{ id: oldSessionId, endedAt: null }])
    const consumedAttempt = await prisma.authorizationAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: { consumedAt: true },
    })
    expect(consumedAttempt.consumedAt).toBeInstanceOf(Date)
    expect(
      await prisma.securityAudit.findMany({
        orderBy: { createdAt: "asc" },
        select: { action: true, context: true, outcome: true, targetId: true },
      }),
    ).toEqual([
      {
        action: "admission.failed",
        context: { reason: "transaction_error" },
        outcome: "FAILURE",
        targetId: externalIdentityId,
      },
    ])
  })
})
