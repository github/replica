import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { getSessionRevocationStatus } from "../../../repositories/session-revocation-states/get-session-revocation-status"
import { endAllHubSessions } from "."

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

async function createMember(input: { administrator?: boolean; login: string }) {
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
    data: { id: randomUUID(), login: input.login, provider: "github", userId },
  })
  await prisma.membership.create({ data: { id: membershipId, userId } })
  const assignmentId = randomUUID()
  if (input.administrator) {
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId,
        id: assignmentId,
        membershipId,
        role: "ADMINISTRATOR",
        source: "BOOTSTRAP",
      },
    })
  }
  return { assignmentId, externalIdentityId, membershipId, userId }
}

async function createSession(input: {
  digestCharacter: string
  externalIdentityId: string
  membershipId: string
  providerRevisionId: string
  revision: number
}) {
  const id = randomUUID()
  await prisma.hubSession.create({
    data: {
      digest: input.digestCharacter.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      externalIdentityId: input.externalIdentityId,
      id,
      membershipId: input.membershipId,
      providerRevisionId: input.providerRevisionId,
      revocationRevision: input.revision,
    },
  })
  return id
}

async function createFixture(input: { authorizationExpired?: boolean } = {}) {
  const providerRevisionId = await createProvider()
  const actor = await createMember({ administrator: true, login: "actor" })
  const other = await createMember({ login: "other" })
  const { revision } = await prisma.sessionRevocationState.findUniqueOrThrow({
    select: { revision: true },
    where: { key: "global" },
  })
  const actorSessionId = await createSession({
    digestCharacter: "b",
    externalIdentityId: actor.externalIdentityId,
    membershipId: actor.membershipId,
    providerRevisionId,
    revision,
  })
  const otherSessionId = await createSession({
    digestCharacter: "c",
    externalIdentityId: other.externalIdentityId,
    membershipId: other.membershipId,
    providerRevisionId,
    revision,
  })
  const authorizationId = randomUUID()
  await prisma.sensitiveAuthorization.create({
    data: {
      actorMembershipId: actor.membershipId,
      expiresAt: new Date(Date.now() + (input.authorizationExpired ? -60_000 : 60_000)),
      externalIdentityId: actor.externalIdentityId,
      hubSessionId: actorSessionId,
      id: authorizationId,
      operation: "END_ALL_HUB_SESSIONS",
      targetMembershipIds: [],
      verifiedAt: new Date(),
    },
  })
  const otherAuthorizationId = randomUUID()
  await prisma.sensitiveAuthorization.create({
    data: {
      actorMembershipId: actor.membershipId,
      expiresAt: new Date(Date.now() + 60_000),
      externalIdentityId: actor.externalIdentityId,
      hubSessionId: actorSessionId,
      id: otherAuthorizationId,
      operation: "DESIGNATE_ADMINISTRATORS",
      targetMembershipIds: [other.membershipId],
      verifiedAt: new Date(),
    },
  })
  await prisma.authorizationAttempt.create({
    data: {
      browserBindingDigest: "d".repeat(64),
      codeVerifierCiphertext: "encrypted-verifier",
      expiresAt: new Date(Date.now() + 60_000),
      id: randomUUID(),
      providerRevisionId,
      purpose: "SIGN_IN",
      sessionRevocationRevision: revision,
      stateDigest: "e".repeat(64),
    },
  })
  const repositoryId = randomUUID()
  await prisma.repository.create({
    data: {
      defaultBranch: "main",
      id: repositoryId,
      nameWithOwner: "github/unchanged",
    },
  })
  const prototypeId = randomUUID()
  await prisma.prototype.create({
    data: {
      branchName: "feature/unchanged",
      id: prototypeId,
      name: "Unchanged prototype",
      repositoryId,
    },
  })
  return {
    actor,
    actorSessionId,
    authorizationId,
    otherAuthorizationId,
    otherSessionId,
    prototypeId,
    revision,
  }
}

describe("endAllHubSessions()", () => {
  it("atomically advances revocation, ends every session, cancels other authorization, and reports counts", async () => {
    const fixture = await createFixture()

    await expect(getSessionRevocationStatus(prisma)).resolves.toEqual({
      activeSessionCount: 2,
      pendingAuthenticationCount: 1,
      pendingSensitiveAuthorizationCount: 2,
      revision: fixture.revision,
    })
    await expect(
      endAllHubSessions(prisma, {
        authorizationId: fixture.authorizationId,
        hubSessionId: fixture.actorSessionId,
      }),
    ).resolves.toEqual({
      cancelledAuthorizationCount: 1,
      endedSessionCount: 2,
      revision: fixture.revision + 1,
    })

    await expect(getSessionRevocationStatus(prisma)).resolves.toEqual({
      activeSessionCount: 0,
      pendingAuthenticationCount: 0,
      pendingSensitiveAuthorizationCount: 0,
      revision: fixture.revision + 1,
    })
    const sessions = await prisma.hubSession.findMany({
      orderBy: { id: "asc" },
      select: { endedAt: true, id: true },
    })
    expect(sessions).toHaveLength(2)
    expect(sessions.every(({ endedAt }) => endedAt instanceof Date)).toBe(true)
    const continuedAuthorization = await prisma.sensitiveAuthorization.findUniqueOrThrow({
      select: { cancelledAt: true, continuedAt: true },
      where: { id: fixture.authorizationId },
    })
    expect(continuedAuthorization.cancelledAt).toBeNull()
    expect(continuedAuthorization.continuedAt).toBeInstanceOf(Date)
    const cancelledAuthorization = await prisma.sensitiveAuthorization.findUniqueOrThrow({
      select: { cancelledAt: true, continuedAt: true },
      where: { id: fixture.otherAuthorizationId },
    })
    expect(cancelledAuthorization.cancelledAt).toBeInstanceOf(Date)
    expect(cancelledAuthorization.continuedAt).toBeNull()
    await expect(
      prisma.securityAudit.findFirstOrThrow({
        select: { action: true, context: true, outcome: true },
        where: { action: "session.revocation.end_all" },
      }),
    ).resolves.toEqual({
      action: "session.revocation.end_all",
      context: {
        actorMembershipId: fixture.actor.membershipId,
        cancelledAuthorizationCount: 1,
        endedSessionCount: 2,
        revision: fixture.revision + 1,
      },
      outcome: "SUCCESS",
    })
    await expect(
      prisma.prototype.findUniqueOrThrow({
        select: { branchName: true, name: true },
        where: { id: fixture.prototypeId },
      }),
    ).resolves.toEqual({
      branchName: "feature/unchanged",
      name: "Unchanged prototype",
    })
  })

  it.each([
    {
      expectedReason: "expired",
      fixtureInput: { authorizationExpired: true },
      makeStale: async () => {},
      name: "authorization",
    },
    {
      expectedReason: "session_mismatch",
      fixtureInput: {},
      makeStale: async (fixture: Awaited<ReturnType<typeof createFixture>>) => {
        await prisma.hubSession.update({
          data: { endedAt: new Date() },
          where: { id: fixture.actorSessionId },
        })
      },
      name: "session",
    },
    {
      expectedReason: "not_authorized",
      fixtureInput: {},
      makeStale: async (fixture: Awaited<ReturnType<typeof createFixture>>) => {
        await prisma.membershipAssignment.update({
          data: { lifecycle: "REVOKED" },
          where: { id: fixture.actor.assignmentId },
        })
      },
      name: "administrator authority",
    },
  ])(
    "denies stale $name without partial mutation",
    async ({ expectedReason, fixtureInput, makeStale }) => {
      const fixture = await createFixture(fixtureInput)
      await makeStale(fixture)
      const before = await getSessionRevocationStatus(prisma)

      await expect(
        endAllHubSessions(prisma, {
          authorizationId: fixture.authorizationId,
          hubSessionId: fixture.actorSessionId,
        }),
      ).rejects.toMatchObject({ reason: expectedReason })

      await expect(getSessionRevocationStatus(prisma)).resolves.toEqual(before)
      await expect(
        prisma.sensitiveAuthorization.findUniqueOrThrow({
          select: { cancelledAt: true },
          where: { id: fixture.otherAuthorizationId },
        }),
      ).resolves.toEqual({ cancelledAt: null })
      await expect(
        prisma.sensitiveAuthorization.findUniqueOrThrow({
          select: { continuedAt: true },
          where: { id: fixture.authorizationId },
        }),
      ).resolves.toEqual({ continuedAt: null })
      await expect(
        prisma.hubSession.findUniqueOrThrow({
          select: { endedAt: true },
          where: { id: fixture.otherSessionId },
        }),
      ).resolves.toEqual({ endedAt: null })
      await expect(
        prisma.securityAudit.count({ where: { action: "session.revocation.end_all" } }),
      ).resolves.toBe(0)
    },
  )
})
