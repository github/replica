import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { admitAuthenticationProof } from "./admit-authentication-proof"
import { AdmissionPersistenceError } from "./errors"
import { restoreHubSession } from "./restore-hub-session"
import { runAdmissionTransaction } from "./run-admission-transaction"
import { runSessionRestoreTransaction } from "./run-session-restore-transaction"

async function createProviderAttempt(input: { existingMembership: boolean }) {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  const attemptId = randomUUID()
  const oldSessionDigest = randomBytes(32).toString("hex")
  let oldSessionId: string | undefined
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
        subject: "first-provider-assignment-subject",
        userId,
      },
    })
    if (input.existingMembership) {
      await transaction.membership.create({ data: { id: membershipId, userId } })
      oldSessionId = randomUUID()
      await transaction.hubSession.create({
        data: {
          digest: oldSessionDigest,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          id: oldSessionId,
          membershipId,
          revocationRevision: 0,
        },
      })
    }
    await transaction.authorizationAttempt.create({
      data: {
        browserBindingDigest: randomBytes(32).toString("hex"),
        codeVerifierCiphertext: "encrypted-verifier",
        consumedAt: new Date("2026-11-05T13:00:00Z"),
        createdAt: new Date("2026-11-05T12:59:00Z"),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        id: attemptId,
        nonceCiphertext: "encrypted-nonce",
        providerRevisionId,
        purpose: "SIGN_IN",
        stateDigest: randomBytes(32).toString("hex"),
        updatedAt: new Date("2026-11-05T13:00:00Z"),
      },
    })
  })
  return {
    attemptId,
    externalIdentityId,
    membershipId,
    oldSessionDigest,
    oldSessionId,
    providerRevisionId,
  }
}

function admitFirstProviderAssignment(records: Awaited<ReturnType<typeof createProviderAttempt>>) {
  return admitAuthenticationProof(
    {
      proof: {
        authorizationAttemptId: records.attemptId,
        externalIdentityId: records.externalIdentityId,
      },
      providerAssignment: {
        assignmentSubject: "22222222-2222-4222-8222-222222222222",
        issuedAt: new Date("2026-11-05T13:00:00Z"),
        providerRevisionId: records.providerRevisionId,
        role: "MEMBER",
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

describe("first provider assignment", () => {
  it("ends retained sessions before granting provider authority to an existing membership", async () => {
    const records = await createProviderAttempt({ existingMembership: true })

    await expect(admitFirstProviderAssignment(records)).resolves.toMatchObject({ role: "MEMBER" })

    const oldSession = await prisma.hubSession.findUniqueOrThrow({
      select: { endedAt: true },
      where: { id: records.oldSessionId },
    })
    expect(oldSession.endedAt).toBeInstanceOf(Date)
    await expect(
      restoreHubSession(records.oldSessionDigest, {
        runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
      }),
    ).resolves.toBeNull()
    await expect(
      prisma.membershipAssignment.findFirst({
        select: { role: true },
        where: {
          lifecycle: "ACTIVE",
          membershipId: records.membershipId,
          source: "AUTHENTICATION_PROVIDER",
        },
      }),
    ).resolves.toEqual({ role: "MEMBER" })
    await expect(
      prisma.securityAudit.count({
        where: { action: "session.ended", targetId: records.oldSessionId },
      }),
    ).resolves.toBe(1)
  })

  it("does not terminate sessions when the provider evidence creates the membership", async () => {
    const records = await createProviderAttempt({ existingMembership: false })

    await expect(admitFirstProviderAssignment(records)).resolves.toMatchObject({ role: "MEMBER" })

    await expect(prisma.membership.count()).resolves.toBe(1)
    await expect(prisma.hubSession.count()).resolves.toBe(1)
    await expect(prisma.securityAudit.count({ where: { action: "session.ended" } })).resolves.toBe(
      0,
    )
  })

  it("rolls back authority, evidence order, and session termination when its audit fails", async () => {
    const records = await createProviderAttempt({ existingMembership: true })
    const suffix = randomUUID().replaceAll("-", "")
    const functionName = `fail_provider_assignment_audit_${suffix}`
    const triggerName = `fail_provider_assignment_audit_${suffix}`
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.action = 'session.ended' THEN
          RAISE EXCEPTION 'session audit unavailable';
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
      await expect(admitFirstProviderAssignment(records)).rejects.toBeInstanceOf(
        AdmissionPersistenceError,
      )
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON security_audits`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`)
    }

    await expect(
      prisma.membershipAssignment.count({
        where: { source: "AUTHENTICATION_PROVIDER" },
      }),
    ).resolves.toBe(0)
    await expect(
      prisma.providerEvidenceState.findUnique({
        where: { externalIdentityId: records.externalIdentityId },
      }),
    ).resolves.toBeNull()
    await expect(
      prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true },
        where: { id: records.oldSessionId },
      }),
    ).resolves.toEqual({ endedAt: null })
    await expect(prisma.hubSession.count()).resolves.toBe(1)
    await expect(
      prisma.securityAudit.findMany({
        select: { action: true, context: true, outcome: true },
      }),
    ).resolves.toEqual([
      {
        action: "admission.failed",
        context: { reason: "transaction_error" },
        outcome: "FAILURE",
      },
    ])
  })
})
