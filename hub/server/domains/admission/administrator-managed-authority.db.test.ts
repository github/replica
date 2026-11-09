import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { admitAuthenticationProof } from "./admit-authentication-proof"
import { restoreHubSession } from "./restore-hub-session"
import { runAdmissionTransaction } from "./run-admission-transaction"
import { runSessionRestoreTransaction } from "./run-session-restore-transaction"

async function createAdministratorSignIn(input: { withMemberFallback: boolean }) {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  const managedAssignmentId = randomUUID()
  const attemptId = randomUUID()
  const sessionId = randomUUID()
  const sessionDigest = randomBytes(32).toString("hex")
  await prisma.$transaction(async (transaction) => {
    await transaction.authenticationProvider.create({
      data: { enabled: false, id: providerId, key: "github" },
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
      data: { enabled: true, selectedRevisionId: providerRevisionId },
      where: { id: providerId },
    })
    await transaction.user.create({ data: { id: userId } })
    await transaction.externalIdentity.create({
      data: {
        id: externalIdentityId,
        issuer: "https://github.com",
        provider: "github",
        subject: randomUUID(),
        userId,
      },
    })
    await transaction.membership.create({ data: { id: membershipId, userId } })
    await transaction.membershipAssignment.create({
      data: {
        externalIdentityId,
        id: managedAssignmentId,
        membershipId,
        role: "ADMINISTRATOR",
        source: "HUB_ADMINISTRATOR",
      },
    })
    if (input.withMemberFallback) {
      await transaction.membershipAssignment.create({
        data: {
          externalIdentityId,
          id: randomUUID(),
          membershipId,
          providerAssignmentSubject: randomUUID(),
          providerRevisionId,
          role: "MEMBER",
          source: "AUTHENTICATION_PROVIDER",
        },
      })
    }
    await transaction.authorizationAttempt.create({
      data: {
        browserBindingDigest: randomBytes(32).toString("hex"),
        codeVerifierCiphertext: "encrypted-verifier",
        consumedAt: new Date("2026-11-09T20:00:00Z"),
        createdAt: new Date("2026-11-09T19:59:00Z"),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        id: attemptId,
        nonceCiphertext: "encrypted-nonce",
        providerRevisionId,
        sessionRevocationRevision: 0,
        purpose: "SIGN_IN",
        stateDigest: randomBytes(32).toString("hex"),
        updatedAt: new Date("2026-11-09T20:00:00Z"),
      },
    })
  })

  const result = await admitAuthenticationProof(
    {
      proof: { authorizationAttemptId: attemptId, externalIdentityId },
      providerKey: "github",
      requiresProviderAssignmentEvidence: false,
      sessionDigest,
      sessionId,
      sessionLifetimeSeconds: 3_600,
    },
    {
      createId: randomUUID,
      getBootstrapSecretDigest: () => "f".repeat(64),
      runTransaction: (operation) => runAdmissionTransaction(prisma, operation),
      writeAudit: (event) => createSecurityAudit(prisma, event),
    },
  )
  return {
    externalIdentityId,
    managedAssignmentId,
    membershipId,
    result,
    sessionDigest,
    userId,
  }
}

function restore(digest: string) {
  return restoreHubSession(digest, {
    runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
  })
}

async function revokeManagedAssignment(id: string) {
  await prisma.membershipAssignment.update({
    data: {
      lifecycle: "REVOKED",
      updatedAt: new Date("2098-01-01T00:00:00Z"),
    },
    where: { id },
  })
}

describe("administrator-managed admission authority", () => {
  it("admits and restores administrator authority, then denies restoration after revocation", async () => {
    const records = await createAdministratorSignIn({ withMemberFallback: false })

    expect(records.result).toMatchObject({ role: "ADMINISTRATOR" })
    await expect(restore(records.sessionDigest)).resolves.toEqual({
      externalIdentityId: records.externalIdentityId,
      membershipId: records.membershipId,
      userId: records.userId,
      role: "ADMINISTRATOR",
    })

    await revokeManagedAssignment(records.managedAssignmentId)

    await expect(restore(records.sessionDigest)).resolves.toBeNull()
  })

  it("falls back to active member authority after administrator-managed revocation", async () => {
    const records = await createAdministratorSignIn({ withMemberFallback: true })

    expect(records.result).toMatchObject({ role: "ADMINISTRATOR" })
    await revokeManagedAssignment(records.managedAssignmentId)

    await expect(restore(records.sessionDigest)).resolves.toEqual({
      externalIdentityId: records.externalIdentityId,
      membershipId: records.membershipId,
      userId: records.userId,
      role: "MEMBER",
    })
  })
})
