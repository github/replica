import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { admitAuthenticationProof } from "./admit-authentication-proof"
import { AdmissionPersistenceError } from "./errors"
import { runAdmissionTransaction } from "./run-admission-transaction"

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
    const suffix = randomUUID().replaceAll("-", "")
    const functionName = `fail_session_audit_${suffix}`
    const triggerName = `fail_session_audit_${suffix}`
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
          id: attemptId,
          providerRevisionId: revisionId,
          purpose: "ADMIN_ENROLLMENT",
          stateDigest: "b".repeat(64),
          browserBindingDigest: "c".repeat(64),
          codeVerifierCiphertext: "encrypted",
          createdAt: new Date("2020-01-01T00:00:00Z"),
          updatedAt: new Date("2020-01-01T00:00:00Z"),
          expiresAt: new Date("2030-01-01T00:00:00Z"),
          consumedAt: new Date("2020-01-01T00:01:00Z"),
        },
      })
    })

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.action = 'session.ended' THEN
          RAISE EXCEPTION 'ended session audit unavailable';
        END IF;
        RETURN NEW;
      END;
      $$
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON security_audits
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `)
    try {
      await expect(
        admitAuthenticationProof(
          {
            proof: { authorizationAttemptId: attemptId, externalIdentityId },
            providerKey: "github",
            sessionDigest: "d".repeat(64),
            sessionId,
            sessionLifetimeSeconds: 3_600,
          },
          {
            createId: randomUUID,
            runTransaction: (operation) => runAdmissionTransaction(prisma, operation),
            writeAudit: (event) => createSecurityAudit(prisma, event),
          },
        ),
      ).rejects.toBeInstanceOf(AdmissionPersistenceError)
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON security_audits`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`)
    }

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
