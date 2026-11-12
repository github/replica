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

  it("applies fresh Entra role loss before denying administrator authorization", async () => {
    const providerId = randomUUID()
    const providerRevisionId = randomUUID()
    const userId = randomUUID()
    const externalIdentityId = randomUUID()
    const membershipId = randomUUID()
    const hubSessionId = randomUUID()
    const authorizationId = randomUUID()
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
    const assignmentId = randomUUID()
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
    await prisma.copilotConnectionState.update({
      data: {
        connectedByMembershipId: membershipId,
        generation: 1n,
        tokenDigest: "c".repeat(64),
        verifiedAt: new Date(),
      },
      where: { key: "global" },
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
            assignmentSubject: null,
            issuedAt: new Date(),
            providerRevisionId,
            role: null,
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
    ).resolves.toEqual({ lifecycle: "REVOKED" })
    const endedProviderSession = await prisma.hubSession.findUniqueOrThrow({
      select: { endedAt: true },
      where: { id: hubSessionId },
    })
    expect(endedProviderSession.endedAt).toBeInstanceOf(Date)
    await expect(
      prisma.copilotConnectionState.findUniqueOrThrow({
        select: { connectedByMembershipId: true, generation: true },
        where: { key: "global" },
      }),
    ).resolves.toEqual({ connectedByMembershipId: null, generation: 2n })
    await expect(
      prisma.securityAudit.findFirstOrThrow({
        select: { context: true },
        where: { action: "copilot.connection.disconnect" },
      }),
    ).resolves.toEqual({
      context: {
        actorMembershipId: null,
        connectorMembershipId: membershipId,
        operation: "disconnect",
        reason: "connector_role_removed",
      },
    })
  })

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
