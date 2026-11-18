import { randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { searchAdministratorCandidates } from "../../repositories/memberships/search-administrator-candidates"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { cancelSensitiveAuthorization } from "../../repositories/sensitive-authorizations/cancel-sensitive-authorization"
import { getSensitiveAuthorizationAuditData } from "../../repositories/sensitive-authorizations/get-sensitive-authorization-audit-data"
import { continueAdministratorAuthorization } from "./continue-administrator-authorization"
import { runAdministratorAuthorizationVerificationTransaction } from "./run-administrator-authorization-verification-transaction"
import type { AdministratorAuthorizationVerificationRepositories } from "./run-administrator-authorization-verification-transaction/types"
import { verifyAdministratorAuthorization } from "./verify-administrator-authorization"

function runVerificationTransaction<Result>(
  operation: (repositories: AdministratorAuthorizationVerificationRepositories) => Promise<Result>,
): Promise<Result> {
  return runAdministratorAuthorizationVerificationTransaction(prisma, operation)
}

function verificationDependencies() {
  return {
    createId: randomUUID,
    getAuthorizationAuditData: (id: string) => getSensitiveAuthorizationAuditData(prisma, id),
    runTransaction: runVerificationTransaction,
    writeAudit: (event: Parameters<typeof createSecurityAudit>[1]) =>
      createSecurityAudit(prisma, event),
  }
}

async function createProvider() {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  await prisma.authenticationProvider.create({
    data: { enabled: false, id: providerId, key: "github" },
  })
  await prisma.authenticationProviderRevision.create({
    data: {
      configurationDigest: "a".repeat(64),
      id: providerRevisionId,
      providerId,
      revision: 1,
    },
  })
  await prisma.authenticationProvider.update({
    data: { enabled: true, selectedRevisionId: providerRevisionId },
    where: { id: providerId },
  })
  return providerRevisionId
}

async function createMembership(input: {
  administrator?: boolean
  lifecycle?: "ACTIVE" | "SUSPENDED"
  login: string
  name?: string
}) {
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  await prisma.user.create({ data: { id: userId } })
  await prisma.externalIdentity.create({
    data: {
      id: externalIdentityId,
      issuer: "https://github.com",
      provider: "github",
      subject: randomUUID(),
      userId,
    },
  })
  await prisma.userProfile.create({
    data: {
      id: randomUUID(),
      login: input.login,
      name: input.name,
      provider: "github",
      userId,
    },
  })
  await prisma.membership.create({
    data: {
      id: membershipId,
      lifecycle: input.lifecycle ?? "ACTIVE",
      userId,
    },
  })
  if (input.administrator) {
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId,
        id: randomUUID(),
        membershipId,
        role: "ADMINISTRATOR",
        source: "BOOTSTRAP",
      },
    })
  }
  return { externalIdentityId, membershipId }
}

async function createAuthorizationFixture(
  operation: "DESIGNATE_ADMINISTRATORS" | "REVOKE_ADMINISTRATOR" = "DESIGNATE_ADMINISTRATORS",
  verified = true,
  lifetimeMilliseconds = 60_000,
  authorizationOverrides?: {
    cancelledAt?: Date
    continuedAt?: Date
    expiresAt?: Date
    verifiedAt?: Date
  },
) {
  const providerRevisionId = await createProvider()
  const actor = await createMembership({ administrator: true, login: "actor" })
  const target = await createMembership({ login: "candidate" })
  const hubSessionId = randomUUID()
  const authorizationId = randomUUID()
  await prisma.hubSession.create({
    data: {
      digest: "b".repeat(64),
      expiresAt: new Date(Date.now() + lifetimeMilliseconds),
      externalIdentityId: actor.externalIdentityId,
      id: hubSessionId,
      membershipId: actor.membershipId,
      providerRevisionId,
      revocationRevision: 0,
    },
  })
  await prisma.sensitiveAuthorization.create({
    data: {
      actorMembershipId: actor.membershipId,
      expiresAt: new Date(Date.now() + 60_000),
      externalIdentityId: actor.externalIdentityId,
      hubSessionId,
      id: authorizationId,
      operation,
      targetMembershipIds: [target.membershipId],
      verifiedAt: verified ? new Date() : null,
      ...authorizationOverrides,
    },
  })
  return { actor, authorizationId, hubSessionId, operation, providerRevisionId, target }
}

async function createConsumedAuthorizationAttempt(input: {
  authorizationId: string
  providerRevisionId: string
}) {
  const authorizationAttemptId = randomUUID()
  const createdAt = new Date()
  await prisma.authorizationAttempt.create({
    data: {
      browserBindingDigest: "d".repeat(64),
      codeVerifierCiphertext: "encrypted-verifier",
      consumedAt: createdAt,
      createdAt,
      expiresAt: new Date(Date.now() + 60_000),
      id: authorizationAttemptId,
      nonceCiphertext: "encrypted-nonce",
      providerRevisionId: input.providerRevisionId,
      purpose: "ADMINISTRATOR_MANAGEMENT",
      sensitiveAuthorizationId: input.authorizationId,
      sessionRevocationRevision: 0,
      stateDigest: randomUUID().replaceAll("-", "").repeat(2),
    },
  })
  return authorizationAttemptId
}

async function createEntraAuthorizationFixture() {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  const hubSessionId = randomUUID()
  const authorizationId = randomUUID()
  const assignmentId = randomUUID()
  await prisma.authenticationProvider.create({
    data: { enabled: false, id: providerId, key: "entra" },
  })
  await prisma.authenticationProviderRevision.create({
    data: {
      configurationDigest: "e".repeat(64),
      id: providerRevisionId,
      providerId,
      revision: 1,
    },
  })
  await prisma.authenticationProvider.update({
    data: { enabled: true, selectedRevisionId: providerRevisionId },
    where: { id: providerId },
  })
  await prisma.user.create({ data: { id: userId } })
  await prisma.externalIdentity.create({
    data: {
      id: externalIdentityId,
      issuer: "https://login.microsoftonline.com/tenant/v2.0",
      provider: "entra",
      subject: randomUUID(),
      userId,
    },
  })
  await prisma.membership.create({ data: { id: membershipId, userId } })
  await prisma.membershipAssignment.create({
    data: {
      externalIdentityId,
      id: assignmentId,
      membershipId,
      providerAssignmentSubject: randomUUID(),
      providerRevisionId,
      role: "ADMINISTRATOR",
      source: "AUTHENTICATION_PROVIDER",
    },
  })
  await prisma.hubSession.create({
    data: {
      digest: "f".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      externalIdentityId,
      id: hubSessionId,
      membershipId,
      providerRevisionId,
      revocationRevision: 0,
    },
  })
  await prisma.sensitiveAuthorization.create({
    data: {
      actorMembershipId: membershipId,
      expiresAt: new Date(Date.now() + 60_000),
      externalIdentityId,
      hubSessionId,
      id: authorizationId,
      operation: "REVOKE_ADMINISTRATOR",
      targetMembershipIds: [membershipId],
    },
  })
  return {
    assignmentId,
    authorizationId,
    externalIdentityId,
    hubSessionId,
    membershipId,
    providerRevisionId,
  }
}

describe("administrator authorization persistence", () => {
  it("verifies the real callback binding before confirmation lookup", async () => {
    const fixture = await createAuthorizationFixture("DESIGNATE_ADMINISTRATORS", false)
    const authorizationAttemptId = await createConsumedAuthorizationAttempt({
      authorizationId: fixture.authorizationId,
      providerRevisionId: fixture.providerRevisionId,
    })

    await expect(
      verifyAdministratorAuthorization(
        {
          authorizationAttemptId,
          externalIdentityId: fixture.actor.externalIdentityId,
          providerKey: "github",
          requiresProviderAssignmentEvidence: false,
          sessionDigest: "b".repeat(64),
          sensitiveAuthorizationId: fixture.authorizationId,
        },
        verificationDependencies(),
      ),
    ).resolves.toBe("DESIGNATE_ADMINISTRATORS")
    const verified = await prisma.sensitiveAuthorization.findUniqueOrThrow({
      select: { verifiedAt: true },
      where: { id: fixture.authorizationId },
    })
    expect(verified.verifiedAt).toBeInstanceOf(Date)
  })

  it.each(["created", "revoked"] as const)(
    "preserves the bootstrap administrator session when its provider assignment is %s",
    async (transition) => {
      const fixture = await createAuthorizationFixture("DESIGNATE_ADMINISTRATORS", false)
      const assignmentId = randomUUID()
      if (transition === "revoked") {
        await prisma.membershipAssignment.create({
          data: {
            externalIdentityId: fixture.actor.externalIdentityId,
            id: assignmentId,
            membershipId: fixture.actor.membershipId,
            providerAssignmentSubject: "repository-access",
            providerRevisionId: fixture.providerRevisionId,
            role: "MEMBER",
            source: "AUTHENTICATION_PROVIDER",
          },
        })
      }
      const otherSessionId = randomUUID()
      await prisma.hubSession.create({
        data: {
          digest: "c".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          externalIdentityId: fixture.actor.externalIdentityId,
          id: otherSessionId,
          membershipId: fixture.actor.membershipId,
          providerRevisionId: fixture.providerRevisionId,
          revocationRevision: 0,
        },
      })
      const authorizationAttemptId = await createConsumedAuthorizationAttempt({
        authorizationId: fixture.authorizationId,
        providerRevisionId: fixture.providerRevisionId,
      })

      await expect(
        verifyAdministratorAuthorization(
          {
            authorizationAttemptId,
            externalIdentityId: fixture.actor.externalIdentityId,
            providerAssignment: {
              assignmentSubject: transition === "created" ? "repository-access" : null,
              issuedAt: new Date(),
              providerRevisionId: fixture.providerRevisionId,
              role: transition === "created" ? "MEMBER" : null,
            },
            providerKey: "github",
            requiresProviderAssignmentEvidence: true,
            sessionDigest: "b".repeat(64),
            sensitiveAuthorizationId: fixture.authorizationId,
          },
          verificationDependencies(),
        ),
      ).resolves.toBe("DESIGNATE_ADMINISTRATORS")
      const authorization = await prisma.sensitiveAuthorization.findUniqueOrThrow({
        select: { verifiedAt: true },
        where: { id: fixture.authorizationId },
      })
      expect(authorization.verifiedAt).toBeInstanceOf(Date)
      await expect(
        prisma.hubSession.findUniqueOrThrow({
          select: { endedAt: true },
          where: { id: fixture.hubSessionId },
        }),
      ).resolves.toEqual({ endedAt: null })
      const otherSession = await prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true },
        where: { id: otherSessionId },
      })
      expect(otherSession.endedAt).toBeInstanceOf(Date)
      await expect(
        prisma.membershipAssignment.findFirstOrThrow({
          select: { lifecycle: true, role: true },
          where: {
            externalIdentityId: fixture.actor.externalIdentityId,
            source: "AUTHENTICATION_PROVIDER",
          },
        }),
      ).resolves.toEqual({
        lifecycle: transition === "created" ? "ACTIVE" : "REVOKED",
        role: "MEMBER",
      })
    },
  )

  it("preserves the Entra administrator session when its assignment subject changes", async () => {
    const fixture = await createEntraAuthorizationFixture()
    const otherSessionId = randomUUID()
    await prisma.hubSession.create({
      data: {
        digest: "c".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        externalIdentityId: fixture.externalIdentityId,
        id: otherSessionId,
        membershipId: fixture.membershipId,
        providerRevisionId: fixture.providerRevisionId,
        revocationRevision: 0,
      },
    })
    const authorizationAttemptId = await createConsumedAuthorizationAttempt({
      authorizationId: fixture.authorizationId,
      providerRevisionId: fixture.providerRevisionId,
    })
    const assignmentSubject = randomUUID()

    await expect(
      verifyAdministratorAuthorization(
        {
          authorizationAttemptId,
          externalIdentityId: fixture.externalIdentityId,
          providerAssignment: {
            assignmentSubject,
            issuedAt: new Date(),
            providerRevisionId: fixture.providerRevisionId,
            role: "ADMINISTRATOR",
          },
          providerKey: "entra",
          requiresProviderAssignmentEvidence: true,
          sessionDigest: "f".repeat(64),
          sensitiveAuthorizationId: fixture.authorizationId,
        },
        verificationDependencies(),
      ),
    ).resolves.toBe("REVOKE_ADMINISTRATOR")
    await expect(
      prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true },
        where: { id: fixture.hubSessionId },
      }),
    ).resolves.toEqual({ endedAt: null })
    const otherSession = await prisma.hubSession.findUniqueOrThrow({
      select: { endedAt: true },
      where: { id: otherSessionId },
    })
    expect(otherSession.endedAt).toBeInstanceOf(Date)
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: fixture.assignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "SUPERSEDED" })
    await expect(
      prisma.membershipAssignment.findFirstOrThrow({
        select: { providerAssignmentSubject: true, role: true },
        where: { lifecycle: "ACTIVE", membershipId: fixture.membershipId },
      }),
    ).resolves.toEqual({ providerAssignmentSubject: assignmentSubject, role: "ADMINISTRATOR" })
  })

  it("preserves the bound Entra session after role removal when Hub administrator authority remains", async () => {
    const fixture = await createEntraAuthorizationFixture()
    const hubAssignmentId = randomUUID()
    const otherSessionId = randomUUID()
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId: fixture.externalIdentityId,
        id: hubAssignmentId,
        membershipId: fixture.membershipId,
        role: "ADMINISTRATOR",
        source: "HUB_ADMINISTRATOR",
      },
    })
    await prisma.hubSession.create({
      data: {
        digest: "c".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        externalIdentityId: fixture.externalIdentityId,
        id: otherSessionId,
        membershipId: fixture.membershipId,
        providerRevisionId: fixture.providerRevisionId,
        revocationRevision: 0,
      },
    })
    const authorizationAttemptId = await createConsumedAuthorizationAttempt({
      authorizationId: fixture.authorizationId,
      providerRevisionId: fixture.providerRevisionId,
    })

    await expect(
      verifyAdministratorAuthorization(
        {
          authorizationAttemptId,
          externalIdentityId: fixture.externalIdentityId,
          providerAssignment: {
            assignmentSubject: null,
            issuedAt: new Date(),
            providerRevisionId: fixture.providerRevisionId,
            role: null,
          },
          providerKey: "entra",
          requiresProviderAssignmentEvidence: true,
          sessionDigest: "f".repeat(64),
          sensitiveAuthorizationId: fixture.authorizationId,
        },
        verificationDependencies(),
      ),
    ).resolves.toBe("REVOKE_ADMINISTRATOR")
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true },
        where: { id: fixture.assignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "REVOKED" })
    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        select: { lifecycle: true, role: true },
        where: { id: hubAssignmentId },
      }),
    ).resolves.toEqual({ lifecycle: "ACTIVE", role: "ADMINISTRATOR" })
    await expect(
      prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true },
        where: { id: fixture.hubSessionId },
      }),
    ).resolves.toEqual({ endedAt: null })
    const otherSession = await prisma.hubSession.findUniqueOrThrow({
      select: { endedAt: true },
      where: { id: otherSessionId },
    })
    expect(otherSession.endedAt).toBeInstanceOf(Date)
    const authorization = await prisma.sensitiveAuthorization.findUniqueOrThrow({
      select: { verifiedAt: true },
      where: { id: fixture.authorizationId },
    })
    expect(authorization.verifiedAt).toBeInstanceOf(Date)
  })

  it.each([null, "MEMBER"] as const)(
    "applies fresh Entra role loss to %s before denying administrator authorization",
    async (role) => {
      const {
        assignmentId,
        authorizationId,
        externalIdentityId,
        hubSessionId,
        membershipId,
        providerRevisionId,
      } = await createEntraAuthorizationFixture()
      await prisma.copilotConnection.create({
        data: {
          connectedByMembershipId: membershipId,
          credentialDigest: "c".repeat(64),
          credentialProvider: "environment_token",
          id: randomUUID(),
          verifiedAt: new Date(),
        },
      })
      const authorizationAttemptId = await createConsumedAuthorizationAttempt({
        authorizationId,
        providerRevisionId,
      })

      await expect(
        verifyAdministratorAuthorization(
          {
            authorizationAttemptId,
            externalIdentityId,
            providerAssignment: {
              assignmentSubject: role === null ? null : randomUUID(),
              issuedAt: new Date(),
              providerRevisionId,
              role,
            },
            providerKey: "entra",
            requiresProviderAssignmentEvidence: true,
            sessionDigest: "f".repeat(64),
            sensitiveAuthorizationId: authorizationId,
          },
          verificationDependencies(),
        ),
      ).resolves.toBeNull()
      await expect(
        prisma.membershipAssignment.findUniqueOrThrow({
          select: { lifecycle: true },
          where: { id: assignmentId },
        }),
      ).resolves.toEqual({ lifecycle: role === null ? "REVOKED" : "SUPERSEDED" })
      await expect(
        prisma.sensitiveAuthorization.findUniqueOrThrow({
          select: { verifiedAt: true },
          where: { id: authorizationId },
        }),
      ).resolves.toEqual({ verifiedAt: null })
      await expect(
        prisma.membershipAssignment.findMany({
          select: { role: true },
          where: { lifecycle: "ACTIVE", membershipId },
        }),
      ).resolves.toEqual(role === null ? [] : [{ role: "MEMBER" }])
      const endedProviderSession = await prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true },
        where: { id: hubSessionId },
      })
      expect(endedProviderSession.endedAt).toBeInstanceOf(Date)
      await expect(
        prisma.copilotConnection.findUnique({
          where: { key: "global" },
        }),
      ).resolves.toBeNull()
      await expect(
        prisma.securityAudit.findFirstOrThrow({
          select: { context: true },
          where: { action: "copilot.connection.disconnected" },
        }),
      ).resolves.toEqual({
        context: {
          actorMembershipId: null,
          credentialProvider: "environment_token",
          phase: "disconnected",
          reason: "connector_role_removed",
        },
      })
    },
  )

  it.each(["expired", "ended", "mismatched"] as const)(
    "does not verify an authorization when its session is %s after fresh provider evidence",
    async (state) => {
      const fixture = await createAuthorizationFixture(
        "DESIGNATE_ADMINISTRATORS",
        false,
        state === "expired" ? -60_000 : 60_000,
      )
      const endedAt = new Date()
      const callbackSessionId = randomUUID()
      if (state === "ended") {
        await prisma.hubSession.update({
          data: { endedAt },
          where: { id: fixture.hubSessionId },
        })
      }
      if (state === "mismatched") {
        await prisma.hubSession.create({
          data: {
            digest: "c".repeat(64),
            expiresAt: new Date(Date.now() + 60_000),
            externalIdentityId: fixture.actor.externalIdentityId,
            id: callbackSessionId,
            membershipId: fixture.actor.membershipId,
            providerRevisionId: fixture.providerRevisionId,
            revocationRevision: 0,
          },
        })
      }
      const originalSession = await prisma.hubSession.findUniqueOrThrow({
        select: { expiresAt: true },
        where: { id: fixture.hubSessionId },
      })
      const authorizationAttemptId = await createConsumedAuthorizationAttempt({
        authorizationId: fixture.authorizationId,
        providerRevisionId: fixture.providerRevisionId,
      })

      await expect(
        verifyAdministratorAuthorization(
          {
            authorizationAttemptId,
            externalIdentityId: fixture.actor.externalIdentityId,
            providerAssignment: {
              assignmentSubject: "repository-access",
              issuedAt: new Date(),
              providerRevisionId: fixture.providerRevisionId,
              role: "MEMBER",
            },
            providerKey: "github",
            requiresProviderAssignmentEvidence: true,
            sessionDigest: (state === "mismatched" ? "c" : "b").repeat(64),
            sensitiveAuthorizationId: fixture.authorizationId,
          },
          verificationDependencies(),
        ),
      ).resolves.toBeNull()
      await expect(
        prisma.sensitiveAuthorization.findUniqueOrThrow({
          select: { verifiedAt: true },
          where: { id: fixture.authorizationId },
        }),
      ).resolves.toEqual({ verifiedAt: null })
      await expect(
        prisma.membershipAssignment.findFirstOrThrow({
          select: { lifecycle: true, role: true },
          where: {
            externalIdentityId: fixture.actor.externalIdentityId,
            source: "AUTHENTICATION_PROVIDER",
          },
        }),
      ).resolves.toEqual({ lifecycle: "ACTIVE", role: "MEMBER" })
      const session = await prisma.hubSession.findUniqueOrThrow({
        select: { endedAt: true, expiresAt: true },
        where: { id: fixture.hubSessionId },
      })
      expect(session.expiresAt).toEqual(originalSession.expiresAt)
      if (state === "ended") expect(session.endedAt).toEqual(endedAt)
      if (state === "mismatched") {
        expect(session.endedAt).toBeInstanceOf(Date)
        const callbackSession = await prisma.hubSession.findUniqueOrThrow({
          select: { endedAt: true },
          where: { id: callbackSessionId },
        })
        expect(callbackSession.endedAt).toBeInstanceOf(Date)
      }
    },
  )

  it.each(["expired", "cancelled", "verified", "continued", "attempt", "identity"] as const)(
    "applies provider evidence without preserving sessions for an invalid %s binding",
    async (state) => {
      const timestamp = new Date()
      const fixture = await createAuthorizationFixture("DESIGNATE_ADMINISTRATORS", false, 60_000, {
        ...(state === "expired" && { expiresAt: new Date(Date.now() - 60_000) }),
        ...(state === "cancelled" && { cancelledAt: timestamp }),
        ...(state === "continued" && { continuedAt: timestamp }),
        ...((state === "verified" || state === "continued") && { verifiedAt: timestamp }),
      })
      const otherSessionId = randomUUID()
      await prisma.hubSession.create({
        data: {
          digest: "c".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          externalIdentityId: fixture.actor.externalIdentityId,
          id: otherSessionId,
          membershipId: fixture.actor.membershipId,
          providerRevisionId: fixture.providerRevisionId,
          revocationRevision: 0,
        },
      })

      const attemptAuthorizationId = state === "attempt" ? randomUUID() : fixture.authorizationId
      if (state === "attempt") {
        await prisma.sensitiveAuthorization.create({
          data: {
            actorMembershipId: fixture.actor.membershipId,
            expiresAt: new Date(Date.now() + 60_000),
            externalIdentityId: fixture.actor.externalIdentityId,
            hubSessionId: fixture.hubSessionId,
            id: attemptAuthorizationId,
            operation: fixture.operation,
            targetMembershipIds: [fixture.target.membershipId],
          },
        })
      }
      const authorizationAttemptId = await createConsumedAuthorizationAttempt({
        authorizationId: attemptAuthorizationId,
        providerRevisionId: fixture.providerRevisionId,
      })
      let externalIdentityId = fixture.actor.externalIdentityId
      if (state === "identity") {
        const actor = await prisma.membership.findUniqueOrThrow({
          select: { userId: true },
          where: { id: fixture.actor.membershipId },
        })
        externalIdentityId = randomUUID()
        await prisma.externalIdentity.create({
          data: {
            id: externalIdentityId,
            issuer: "https://github.com",
            provider: "github",
            subject: randomUUID(),
            userId: actor.userId,
          },
        })
      }

      await expect(
        verifyAdministratorAuthorization(
          {
            authorizationAttemptId,
            externalIdentityId,
            providerAssignment: {
              assignmentSubject: "repository-access",
              issuedAt: new Date(),
              providerRevisionId: fixture.providerRevisionId,
              role: "MEMBER",
            },
            providerKey: "github",
            requiresProviderAssignmentEvidence: true,
            sessionDigest: "b".repeat(64),
            sensitiveAuthorizationId: fixture.authorizationId,
          },
          verificationDependencies(),
        ),
      ).resolves.toBeNull()
      await expect(
        prisma.membershipAssignment.findFirstOrThrow({
          select: { lifecycle: true, role: true },
          where: { externalIdentityId, source: "AUTHENTICATION_PROVIDER" },
        }),
      ).resolves.toEqual({ lifecycle: "ACTIVE", role: "MEMBER" })
      await expect(
        prisma.sensitiveAuthorization.findUniqueOrThrow({
          select: { verifiedAt: true },
          where: { id: fixture.authorizationId },
        }),
      ).resolves.toEqual({
        verifiedAt: state === "verified" || state === "continued" ? timestamp : null,
      })
      const sessions = await prisma.hubSession.findMany({
        select: { endedAt: true },
        where: { id: { in: [fixture.hubSessionId, otherSessionId] } },
      })
      expect(sessions).toHaveLength(2)
      for (const session of sessions) expect(session.endedAt).toBeInstanceOf(Date)
    },
  )

  it("binds one-use continuation to the exact session, operation, and ordered targets", async () => {
    const fixture = await createAuthorizationFixture()
    const targetSessionId = randomUUID()
    await prisma.hubSession.create({
      data: {
        digest: "c".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        externalIdentityId: fixture.target.externalIdentityId,
        id: targetSessionId,
        membershipId: fixture.target.membershipId,
        providerRevisionId: (
          await prisma.authenticationProvider.findFirstOrThrow({
            select: { selectedRevisionId: true },
            where: { key: "github" },
          })
        ).selectedRevisionId!,
        revocationRevision: 0,
      },
    })

    await expect(
      continueAdministratorAuthorization(prisma, {
        hubSessionId: randomUUID(),
        id: fixture.authorizationId,
        operation: fixture.operation,
        targetMembershipIds: [fixture.target.membershipId],
      }),
    ).rejects.toMatchObject({ reason: "session_mismatch" })
    await expect(
      continueAdministratorAuthorization(prisma, {
        hubSessionId: fixture.hubSessionId,
        id: fixture.authorizationId,
        operation: "REVOKE_ADMINISTRATOR",
        targetMembershipIds: [fixture.target.membershipId],
      }),
    ).rejects.toMatchObject({ reason: "invalid_operation" })
    await expect(
      continueAdministratorAuthorization(prisma, {
        hubSessionId: fixture.hubSessionId,
        id: fixture.authorizationId,
        operation: fixture.operation,
        targetMembershipIds: [randomUUID()],
      }),
    ).rejects.toMatchObject({ reason: "invalid_operation" })

    await continueAdministratorAuthorization(prisma, {
      hubSessionId: fixture.hubSessionId,
      id: fixture.authorizationId,
      operation: fixture.operation,
      targetMembershipIds: [fixture.target.membershipId],
    })

    await expect(
      prisma.membershipAssignment.findFirst({
        where: {
          membershipId: fixture.target.membershipId,
          source: "HUB_ADMINISTRATOR",
        },
      }),
    ).resolves.toMatchObject({ lifecycle: "ACTIVE", role: "ADMINISTRATOR" })
    const endedTargetSession = await prisma.hubSession.findUniqueOrThrow({
      select: { endedAt: true },
      where: { id: targetSessionId },
    })
    expect(endedTargetSession.endedAt).toBeInstanceOf(Date)
    await expect(
      continueAdministratorAuthorization(prisma, {
        hubSessionId: fixture.hubSessionId,
        id: fixture.authorizationId,
        operation: fixture.operation,
        targetMembershipIds: [fixture.target.membershipId],
      }),
    ).rejects.toMatchObject({ reason: "used" })
  })

  it("rechecks authorization expiry after waiting for administrator locks", async () => {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) throw new Error("DATABASE_URL is required.")
    const fixture = await createAuthorizationFixture("DESIGNATE_ADMINISTRATORS", true, 150)
    const locker = new pg.Client({ connectionString: databaseUrl })
    await locker.connect()
    try {
      await locker.query("BEGIN")
      await locker.query(`SELECT id FROM memberships WHERE id = $1 FOR UPDATE`, [
        fixture.actor.membershipId,
      ])
      const continuation = continueAdministratorAuthorization(prisma, {
        hubSessionId: fixture.hubSessionId,
        id: fixture.authorizationId,
        operation: fixture.operation,
        targetMembershipIds: [fixture.target.membershipId],
      })
      await new Promise((resolve) => setTimeout(resolve, 250))
      await locker.query("COMMIT")

      await expect(continuation).rejects.toMatchObject({ reason: "expired" })
      await expect(
        prisma.sensitiveAuthorization.findUniqueOrThrow({
          select: { continuedAt: true },
          where: { id: fixture.authorizationId },
        }),
      ).resolves.toEqual({ continuedAt: null })
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined)
      await locker.end()
    }
  })

  it("cancels only the bound session authorization and prevents later continuation", async () => {
    const fixture = await createAuthorizationFixture()

    await expect(
      cancelSensitiveAuthorization(prisma, {
        hubSessionId: randomUUID(),
        id: fixture.authorizationId,
        scope: "administrator",
      }),
    ).resolves.toBeNull()
    await expect(
      cancelSensitiveAuthorization(prisma, {
        hubSessionId: fixture.hubSessionId,
        id: fixture.authorizationId,
        scope: "administrator",
      }),
    ).resolves.toMatchObject({ id: fixture.authorizationId })
    await expect(
      cancelSensitiveAuthorization(prisma, {
        hubSessionId: fixture.hubSessionId,
        id: fixture.authorizationId,
        scope: "administrator",
      }),
    ).resolves.toBeNull()
    await expect(
      continueAdministratorAuthorization(prisma, {
        hubSessionId: fixture.hubSessionId,
        id: fixture.authorizationId,
        operation: fixture.operation,
        targetMembershipIds: [fixture.target.membershipId],
      }),
    ).rejects.toMatchObject({ reason: "cancelled" })
  })

  it("rolls back continuation, mutation, and audits when the completion audit fails", async () => {
    const fixture = await createAuthorizationFixture()
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_administrator_authorization_completion()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'administrator.authorization.completed' THEN
          RAISE EXCEPTION 'administrator authorization completion audit unavailable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_administrator_authorization_completion
      BEFORE INSERT ON security_audits
      FOR EACH ROW EXECUTE FUNCTION fail_administrator_authorization_completion()
    `)
    try {
      await expect(
        continueAdministratorAuthorization(prisma, {
          hubSessionId: fixture.hubSessionId,
          id: fixture.authorizationId,
          operation: fixture.operation,
          targetMembershipIds: [fixture.target.membershipId],
        }),
      ).rejects.toThrow("administrator authorization completion audit unavailable")
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER fail_administrator_authorization_completion ON security_audits`,
      )
      await prisma.$executeRawUnsafe(`DROP FUNCTION fail_administrator_authorization_completion()`)
    }

    await expect(
      prisma.sensitiveAuthorization.findUniqueOrThrow({
        select: { continuedAt: true },
        where: { id: fixture.authorizationId },
      }),
    ).resolves.toEqual({ continuedAt: null })
    await expect(
      prisma.membershipAssignment.count({
        where: {
          membershipId: fixture.target.membershipId,
          source: "HUB_ADMINISTRATOR",
        },
      }),
    ).resolves.toBe(0)
    await expect(
      prisma.securityAudit.findMany({
        select: { action: true, context: true, outcome: true },
        where: {
          action: {
            in: [
              "administrator.authorization.denied",
              "membership.administrator_management.failed",
            ],
          },
        },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        {
          action: "membership.administrator_management.failed",
          context: {
            actorMembershipId: fixture.actor.membershipId,
            operation: "designate",
            reason: "transaction_error",
          },
          outcome: "FAILURE",
        },
        {
          action: "administrator.authorization.denied",
          context: {
            actorMembershipId: fixture.actor.membershipId,
            operation: "designate_administrators",
            phase: "denied",
            reason: "transaction_error",
            targetCount: 1,
          },
          outcome: "DENIED",
        },
      ]),
    )
  })

  it("escapes candidate search wildcards, excludes effective administrators, and bounds results", async () => {
    const literal = await createMembership({
      login: "literal%_candidate",
      name: "Literal candidate",
    })
    await createMembership({ login: "ordinary-candidate" })
    await createMembership({ administrator: true, login: "admin%_candidate" })
    await createMembership({ lifecycle: "SUSPENDED", login: "suspended%_candidate" })

    await expect(searchAdministratorCandidates(prisma, { limit: 1, query: "%_" })).resolves.toEqual(
      [
        {
          login: "literal%_candidate",
          membershipId: literal.membershipId,
          name: "Literal candidate",
          provider: "github",
        },
      ],
    )
    await expect(
      searchAdministratorCandidates(prisma, { limit: 51, query: "candidate" }),
    ).rejects.toBeInstanceOf(Error)
  })
})
