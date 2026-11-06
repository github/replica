import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { admitAuthenticationProof } from "./admit-authentication-proof"
import { runAdmissionTransaction } from "./run-admission-transaction"

const bootstrapSecretDigest = "f".repeat(64)

async function createBootstrapAttempt(input: { existingMember: boolean }) {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  const attemptId = randomUUID()
  let priorSessionId: string | undefined
  await prisma.$transaction(async (transaction) => {
    await transaction.authenticationProvider.create({
      data: { id: providerId, key: "github" },
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
        issuer: "https://github.com",
        provider: "github",
        subject: "bootstrap-subject",
        userId,
      },
    })
    if (input.existingMember) {
      const authorityProviderId = randomUUID()
      const authorityRevisionId = randomUUID()
      const authorityIdentityId = randomUUID()
      await transaction.authenticationProvider.create({
        data: { id: authorityProviderId, key: "entra" },
      })
      await transaction.authenticationProviderRevision.create({
        data: {
          configurationDigest: "b".repeat(64),
          id: authorityRevisionId,
          providerId: authorityProviderId,
          revision: 1,
        },
      })
      await transaction.authenticationProvider.update({
        data: { selectedRevisionId: authorityRevisionId },
        where: { id: authorityProviderId },
      })
      await transaction.externalIdentity.create({
        data: {
          id: authorityIdentityId,
          issuer: "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0",
          provider: "entra",
          subject: "existing-member-subject",
          userId,
        },
      })
      await transaction.membership.create({ data: { id: membershipId, userId } })
      await transaction.membershipAssignment.create({
        data: {
          externalIdentityId: authorityIdentityId,
          id: randomUUID(),
          membershipId,
          providerAssignmentSubject: randomUUID(),
          providerRevisionId: authorityRevisionId,
          role: "MEMBER",
          source: "AUTHENTICATION_PROVIDER",
        },
      })
      priorSessionId = randomUUID()
      await transaction.hubSession.create({
        data: {
          digest: "b".repeat(64),
          expiresAt: new Date("2099-01-01T00:00:00Z"),
          id: priorSessionId,
          membershipId,
          revocationRevision: 0,
        },
      })
    }
    await transaction.authorizationAttempt.create({
      data: {
        bootstrapSecretDigest,
        browserBindingDigest: "c".repeat(64),
        codeVerifierCiphertext: "encrypted-verifier",
        consumedAt: new Date("2026-11-04T20:01:00Z"),
        createdAt: new Date("2026-11-04T20:00:00Z"),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        id: attemptId,
        nonceCiphertext: "encrypted-nonce",
        providerRevisionId,
        sessionRevocationRevision: 0,
        purpose: "ADMIN_ENROLLMENT",
        stateDigest: "d".repeat(64),
        updatedAt: new Date("2026-11-04T20:01:00Z"),
      },
    })
  })
  return { attemptId, externalIdentityId, priorSessionId }
}

async function enroll(records: Awaited<ReturnType<typeof createBootstrapAttempt>>) {
  return admitAuthenticationProof(
    {
      proof: {
        authorizationAttemptId: records.attemptId,
        externalIdentityId: records.externalIdentityId,
      },
      providerKey: "github",
      requiresProviderAssignmentEvidence: false,
      sessionDigest: "e".repeat(64),
      sessionId: randomUUID(),
      sessionLifetimeSeconds: 3_600,
    },
    {
      createId: randomUUID,
      getBootstrapSecretDigest: () => bootstrapSecretDigest,
      runTransaction: (operation) => runAdmissionTransaction(prisma, operation),
      writeAudit: (event) => createSecurityAudit(prisma, event),
    },
  )
}

describe("bootstrap elevation", () => {
  it("ends and audits prior member sessions before issuing the first administrator session", async () => {
    const records = await createBootstrapAttempt({ existingMember: true })

    await expect(enroll(records)).resolves.toMatchObject({ role: "ADMINISTRATOR" })

    const priorSession = await prisma.hubSession.findUniqueOrThrow({
      select: { endedAt: true },
      where: { id: records.priorSessionId },
    })
    expect(priorSession.endedAt).toBeInstanceOf(Date)
    const audits = await prisma.securityAudit.findMany({
      orderBy: { createdAt: "asc" },
      select: { action: true, targetId: true },
    })
    const assignmentAudit = audits.findIndex(
      ({ action }) => action === "membership.assignment.created",
    )
    const endedAudit = audits.findIndex(
      ({ action, targetId }) => action === "session.ended" && targetId === records.priorSessionId,
    )
    const replacementAudit = audits.findIndex(({ action }) => action === "session.created")
    expect(assignmentAudit).toBeGreaterThanOrEqual(0)
    expect(endedAudit).toBeGreaterThan(assignmentAudit)
    expect(replacementAudit).toBeGreaterThan(endedAudit)
  })

  it("does not perform session termination for a brand-new membership", async () => {
    const records = await createBootstrapAttempt({ existingMember: false })

    await expect(enroll(records)).resolves.toMatchObject({ role: "ADMINISTRATOR" })

    await expect(prisma.securityAudit.count({ where: { action: "session.ended" } })).resolves.toBe(
      0,
    )
    await expect(prisma.hubSession.count()).resolves.toBe(1)
  })
})
