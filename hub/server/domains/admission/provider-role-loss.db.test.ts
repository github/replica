import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { admitAuthenticationProof } from "./admit-authentication-proof"
import { runAdmissionTransaction } from "./run-admission-transaction"

async function createProviderRoleSession() {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  const assignmentId = randomUUID()
  const sessionId = randomUUID()
  const attemptId = randomUUID()
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
        subject: "immutable-subject",
        userId,
      },
    })
    await transaction.membership.create({
      data: { id: membershipId, userId },
    })
    await transaction.membershipAssignment.create({
      data: {
        externalIdentityId,
        id: assignmentId,
        membershipId,
        providerAssignmentSubject: "22222222-2222-4222-8222-222222222222",
        providerRevisionId,
        role: "MEMBER",
        source: "AUTHENTICATION_PROVIDER",
      },
    })
    await transaction.hubSession.create({
      data: {
        digest: "b".repeat(64),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        id: sessionId,
        membershipId,
        revocationRevision: 0,
      },
    })
    await transaction.authorizationAttempt.create({
      data: {
        browserBindingDigest: "c".repeat(64),
        codeVerifierCiphertext: "encrypted-verifier",
        consumedAt: new Date("2020-01-01T00:01:00Z"),
        createdAt: new Date("2020-01-01T00:00:00Z"),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        id: attemptId,
        nonceCiphertext: "encrypted-nonce",
        providerRevisionId,
        purpose: "SIGN_IN",
        stateDigest: "d".repeat(64),
        updatedAt: new Date("2020-01-01T00:01:00Z"),
      },
    })
  })
  return {
    assignmentId,
    attemptId,
    externalIdentityId,
    membershipId,
    providerRevisionId,
    sessionId,
  }
}

function revokeProviderRole(records: Awaited<ReturnType<typeof createProviderRoleSession>>) {
  return admitAuthenticationProof(
    {
      proof: {
        authorizationAttemptId: records.attemptId,
        externalIdentityId: records.externalIdentityId,
      },
      providerAssignment: {
        assignmentSubject: null,
        issuedAt: new Date("2026-11-04T20:00:00Z"),
        providerRevisionId: records.providerRevisionId,
        role: null,
      },
      providerKey: "entra",
      requiresProviderAssignmentEvidence: true,
      sessionDigest: "e".repeat(64),
      sessionId: randomUUID(),
      sessionLifetimeSeconds: 3_600,
    },
    {
      createId: randomUUID,
      runTransaction: (operation) => runAdmissionTransaction(prisma, operation),
      writeAudit: (event) => createSecurityAudit(prisma, event),
    },
  )
}

describe("provider role-loss admission", () => {
  it("commits revocation, session termination, and denial audit together", async () => {
    const records = await createProviderRoleSession()

    await expect(revokeProviderRole(records)).rejects.toMatchObject({
      reason: "authority_missing",
    })

    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: records.assignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "REVOKED" })
    const session = await prisma.hubSession.findUniqueOrThrow({
      select: { endedAt: true },
      where: { id: records.sessionId },
    })
    expect(session.endedAt).toBeInstanceOf(Date)
    const actions = await prisma.securityAudit.findMany({
      orderBy: { createdAt: "asc" },
      select: { action: true },
    })
    expect(actions).toEqual(
      expect.arrayContaining([
        { action: "provider.membership.assignment.revoked" },
        { action: "session.ended" },
        { action: "admission.denied" },
      ]),
    )
  })

  it("rolls back role revocation and session termination when the denial audit fails", async () => {
    const records = await createProviderRoleSession()
    const functionName = `reject_denial_${randomUUID().replaceAll("-", "_")}`
    const triggerName = `reject_denial_${randomUUID().replaceAll("-", "_")}`
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.action = 'admission.denied' THEN
          RAISE EXCEPTION 'admission denial audit unavailable';
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
      await expect(revokeProviderRole(records)).rejects.toThrow(
        "Hub admission could not be completed",
      )
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON security_audits`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`)
    }

    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: records.assignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "ACTIVE" })
    await expect(
      prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true },
        where: { id: records.sessionId },
      }),
    ).resolves.toEqual({ endedAt: null })
    expect(
      await prisma.securityAudit.count({
        where: {
          action: {
            in: ["provider.membership.assignment.revoked", "session.ended", "admission.denied"],
          },
        },
      }),
    ).toBe(0)
  })
})
