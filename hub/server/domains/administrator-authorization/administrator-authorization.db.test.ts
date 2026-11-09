import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { searchAdministratorCandidates } from "../../repositories/memberships/search-administrator-candidates"
import { cancelSensitiveAuthorization } from "../../repositories/sensitive-authorizations/cancel-sensitive-authorization"
import { continueAdministratorAuthorization } from "./continue-administrator-authorization"

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
) {
  const providerRevisionId = await createProvider()
  const actor = await createMembership({ administrator: true, login: "actor" })
  const target = await createMembership({ login: "candidate" })
  const hubSessionId = randomUUID()
  const authorizationId = randomUUID()
  await prisma.hubSession.create({
    data: {
      digest: "b".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
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
      verifiedAt: new Date(),
    },
  })
  return { actor, authorizationId, hubSessionId, operation, target }
}

describe("administrator authorization persistence", () => {
  it("binds one-use continuation to the exact session, operation, and ordered targets", async () => {
    const fixture = await createAuthorizationFixture()

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
    await expect(
      continueAdministratorAuthorization(prisma, {
        hubSessionId: fixture.hubSessionId,
        id: fixture.authorizationId,
        operation: fixture.operation,
        targetMembershipIds: [fixture.target.membershipId],
      }),
    ).rejects.toMatchObject({ reason: "used" })
  })

  it("cancels only the bound session authorization and prevents later continuation", async () => {
    const fixture = await createAuthorizationFixture()

    await expect(
      cancelSensitiveAuthorization(prisma, {
        hubSessionId: randomUUID(),
        id: fixture.authorizationId,
      }),
    ).resolves.toBeNull()
    await expect(
      cancelSensitiveAuthorization(prisma, {
        hubSessionId: fixture.hubSessionId,
        id: fixture.authorizationId,
      }),
    ).resolves.toMatchObject({ id: fixture.authorizationId })
    await expect(
      cancelSensitiveAuthorization(prisma, {
        hubSessionId: fixture.hubSessionId,
        id: fixture.authorizationId,
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
      prisma.securityAudit.count({
        where: { targetId: fixture.authorizationId },
      }),
    ).resolves.toBe(0)
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
