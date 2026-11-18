import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createQueryCountingClient } from "../../../../test/database/create-query-counting-client"
import { prisma } from "../../../integrations/prisma"
import { revokeEmptyGitHubRepositoryAccess } from "."

const changedAt = new Date("2026-03-01T00:00:00.000Z")

async function createProviderRevision() {
  const provider = await prisma.authenticationProvider.create({
    data: { enabled: false, key: "github" },
  })
  const revision = await prisma.authenticationProviderRevision.create({
    data: { configurationDigest: "a".repeat(64), providerId: provider.id, revision: 1 },
  })
  await prisma.authenticationProvider.update({
    data: { enabled: true, selectedRevisionId: revision.id },
    where: { id: provider.id },
  })
  return revision.id
}

async function createMembership(
  revisionId: string,
  options: {
    administratorSource?: "BOOTSTRAP"
    lifecycle?: "ACTIVE" | "SUSPENDED"
    role?: "MEMBER" | "ADMINISTRATOR"
    unassignedIdentity?: boolean
  } = {},
) {
  const user = await prisma.user.create({ data: {} })
  const membership = await prisma.membership.create({
    data: { lifecycle: options.lifecycle ?? "ACTIVE", userId: user.id },
  })
  const identity = await prisma.externalIdentity.create({
    data: {
      issuer: "https://github.com",
      provider: "github",
      subject: randomUUID(),
      userId: user.id,
    },
  })
  await prisma.membershipAssignment.create({
    data: {
      externalIdentityId: identity.id,
      membershipId: membership.id,
      providerAssignmentSubject: "github_repository_access",
      providerRevisionId: revisionId,
      role: options.role ?? "MEMBER",
      source: "AUTHENTICATION_PROVIDER",
    },
  })
  if (options.administratorSource) {
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId: identity.id,
        membershipId: membership.id,
        role: "ADMINISTRATOR",
        source: options.administratorSource,
      },
    })
  }
  const unassigned = options.unassignedIdentity
    ? await prisma.externalIdentity.create({
        data: {
          issuer: "https://github.com",
          provider: "github",
          subject: randomUUID(),
          userId: user.id,
        },
      })
    : null
  const session = await createSession(membership.id, identity.id, revisionId)
  return { identityId: identity.id, membershipId: membership.id, session, unassigned }
}

function createSession(membershipId: string, externalIdentityId: string, revisionId?: string) {
  return prisma.hubSession.create({
    data: {
      digest: randomBytes(32).toString("hex"),
      expiresAt: new Date("2099-01-01T00:00:00Z"),
      externalIdentityId,
      membershipId,
      providerRevisionId: revisionId,
      revocationRevision: 0,
    },
  })
}

function revoke(membershipIds: string[]) {
  return prisma.$transaction((transaction) =>
    revokeEmptyGitHubRepositoryAccess(transaction, { changedAt, membershipIds }),
  )
}

describe("revokeEmptyGitHubRepositoryAccess", () => {
  it("revokes provider authority and preserves each membership's remaining access", async () => {
    const revisionId = await createProviderRevision()
    const member = await createMembership(revisionId, { unassignedIdentity: true })
    const administrator = await createMembership(revisionId, {
      administratorSource: "BOOTSTRAP",
      role: "ADMINISTRATOR",
    })
    const suspended = await createMembership(revisionId, { lifecycle: "SUSPENDED" })
    const entra = await prisma.externalIdentity.create({
      data: {
        issuer: "https://login.microsoftonline.com",
        provider: "entra",
        subject: randomUUID(),
        userId: (await prisma.membership.findUniqueOrThrow({ where: { id: member.membershipId } }))
          .userId,
      },
    })
    const entraSession = await createSession(member.membershipId, entra.id)
    await prisma.copilotConnection.create({
      data: {
        connectedByMembershipId: member.membershipId,
        credentialDigest: "c".repeat(64),
        credentialProvider: "environment_token",
        verifiedAt: new Date(),
      },
    })
    await prisma.copilotConnectionState.update({
      data: { generation: 4 },
      where: { key: "global" },
    })

    await revoke([member.membershipId, administrator.membershipId, suspended.membershipId])

    await expect(
      prisma.membershipAssignment.findMany({
        select: { lifecycle: true, source: true },
        where: { source: "AUTHENTICATION_PROVIDER" },
      }),
    ).resolves.toEqual(Array(3).fill({ lifecycle: "REVOKED", source: "AUTHENTICATION_PROVIDER" }))
    await expect(
      prisma.membershipAssignment.count({ where: { lifecycle: "ACTIVE", source: "BOOTSTRAP" } }),
    ).resolves.toBe(1)
    await expect(
      prisma.providerEvidenceState.findMany({
        orderBy: { externalIdentityId: "asc" },
        select: { externalIdentityId: true, lastIssuedAt: true, lastRole: true },
      }),
    ).resolves.toEqual(
      [member.identityId, member.unassigned!.id, administrator.identityId, suspended.identityId]
        .sort()
        .map((externalIdentityId) => ({
          externalIdentityId,
          lastIssuedAt: changedAt,
          lastRole: null,
        })),
    )
    const sessions = await prisma.hubSession.findMany({
      select: { endReason: true, endedAt: true, id: true },
    })
    expect(sessions.every((session) => session.endedAt)).toBe(true)
    expect(Object.fromEntries(sessions.map((session) => [session.id, session.endReason]))).toEqual({
      [administrator.session.id]: null,
      [entraSession.id]: null,
      [member.session.id]: "GITHUB_REPOSITORY_ACCESS_REVOKED",
      [suspended.session.id]: null,
    })
    await expect(prisma.copilotConnection.count()).resolves.toBe(0)
    await expect(
      prisma.copilotConnectionState.findUniqueOrThrow({ where: { key: "global" } }),
    ).resolves.toMatchObject({ generation: 5n })
    const audits = await prisma.securityAudit.groupBy({ _count: true, by: ["action"] })
    expect(Object.fromEntries(audits.map((audit) => [audit.action, audit._count]))).toEqual({
      "copilot.connection.disconnected": 1,
      "provider.membership.assignment.revoked": 3,
      "session.ended": 4,
    })
  })

  it("keeps a Copilot connection made by a remaining administrator", async () => {
    const revisionId = await createProviderRevision()
    const administrator = await createMembership(revisionId, {
      administratorSource: "BOOTSTRAP",
      role: "ADMINISTRATOR",
    })
    await prisma.copilotConnection.create({
      data: {
        connectedByMembershipId: administrator.membershipId,
        credentialDigest: "c".repeat(64),
        credentialProvider: "environment_token",
        verifiedAt: new Date(),
      },
    })

    await revoke([administrator.membershipId])

    await expect(prisma.copilotConnection.count()).resolves.toBe(1)
  })

  it("changes nothing when newer provider evidence exists", async () => {
    const revisionId = await createProviderRevision()
    const first = await createMembership(revisionId)
    const second = await createMembership(revisionId)
    await prisma.providerEvidenceState.create({
      data: {
        externalIdentityId: second.identityId,
        lastIssuedAt: new Date(changedAt.getTime() + 1),
        lastRole: "MEMBER",
      },
    })

    await expect(revoke([first.membershipId, second.membershipId])).rejects.toThrow(
      "GitHub repository revocation evidence did not advance.",
    )

    await expect(
      prisma.membershipAssignment.count({ where: { lifecycle: "ACTIVE" } }),
    ).resolves.toBe(2)
    await expect(prisma.hubSession.count({ where: { endedAt: null } })).resolves.toBe(2)
    await expect(prisma.providerEvidenceState.count()).resolves.toBe(1)
  })

  it("revokes 1,000 memberships in a fixed number of statements", { timeout: 60_000 }, async () => {
    const revisionId = await createProviderRevision()
    const users = Array.from({ length: 1_000 }, () => ({ id: randomUUID() }))
    const memberships = users.map((user) => ({ id: randomUUID(), userId: user.id }))
    const identities = users.map((user, index) => ({
      id: randomUUID(),
      issuer: "https://github.com",
      provider: "github",
      subject: String(index + 1),
      userId: user.id,
    }))
    await prisma.user.createMany({ data: users })
    await prisma.membership.createMany({ data: memberships })
    await prisma.externalIdentity.createMany({ data: identities })
    await prisma.membershipAssignment.createMany({
      data: memberships.map((membership, index) => ({
        externalIdentityId: identities[index]!.id,
        membershipId: membership.id,
        providerAssignmentSubject: "github_repository_access",
        providerRevisionId: revisionId,
        role: "MEMBER" as const,
        source: "AUTHENTICATION_PROVIDER" as const,
      })),
    })
    await prisma.hubSession.createMany({
      data: memberships.map((membership, index) => ({
        digest: randomBytes(32).toString("hex"),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        externalIdentityId: identities[index]!.id,
        membershipId: membership.id,
        providerRevisionId: revisionId,
        revocationRevision: 0,
      })),
    })
    const counted = createQueryCountingClient()

    await counted.client
      .$transaction((transaction) =>
        revokeEmptyGitHubRepositoryAccess(transaction, {
          changedAt,
          membershipIds: memberships.map((membership) => membership.id),
        }),
      )
      .finally(() => counted.client.$disconnect())

    expect(counted.statements()).toBeLessThanOrEqual(11)
    await expect(
      prisma.membershipAssignment.count({ where: { lifecycle: "REVOKED" } }),
    ).resolves.toBe(1_000)
    await expect(prisma.hubSession.count({ where: { endedAt: null } })).resolves.toBe(0)
    await expect(prisma.securityAudit.count()).resolves.toBe(2_000)
  })
})
