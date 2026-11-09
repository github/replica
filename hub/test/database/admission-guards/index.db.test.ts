import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../server/integrations/prisma"

async function createProviderRevision() {
  const providerId = randomUUID()
  const revisionId = randomUUID()
  await prisma.$transaction(async (transaction) => {
    await transaction.authenticationProvider.create({
      data: { id: providerId, key: `provider-${providerId}` },
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
  })
  return revisionId
}

async function createAdmissionAuthority() {
  const firstUserId = randomUUID()
  const secondUserId = randomUUID()
  const firstIdentityId = randomUUID()
  const secondIdentityId = randomUUID()
  const firstMembershipId = randomUUID()
  const secondMembershipId = randomUUID()
  const assignmentId = randomUUID()
  await prisma.user.createMany({
    data: [{ id: firstUserId }, { id: secondUserId }],
  })
  await prisma.externalIdentity.createMany({
    data: [
      {
        id: firstIdentityId,
        userId: firstUserId,
        provider: "github",
        issuer: "https://github.com",
        subject: "first",
      },
      {
        id: secondIdentityId,
        userId: secondUserId,
        provider: "github",
        issuer: "https://github.com",
        subject: "second",
      },
    ],
  })
  await prisma.membership.createMany({
    data: [
      { id: firstMembershipId, userId: firstUserId },
      { id: secondMembershipId, userId: secondUserId },
    ],
  })
  await prisma.membershipAssignment.create({
    data: {
      id: assignmentId,
      membershipId: firstMembershipId,
      externalIdentityId: firstIdentityId,
      source: "BOOTSTRAP",
      role: "ADMINISTRATOR",
    },
  })
  return {
    assignmentId,
    firstIdentityId,
    firstMembershipId,
    secondIdentityId,
    secondMembershipId,
    secondUserId,
  }
}

describe("admission database guards", () => {
  it("deploys provider assignment enum values at the supported PostgreSQL minimum or newer", async () => {
    const server = await prisma.$queryRaw<Array<{ serverMajor: number }>>`
      SELECT current_setting('server_version_num')::integer / 10000 AS "serverMajor"
    `
    expect(server[0]!.serverMajor).toBeGreaterThanOrEqual(17)

    const values = await prisma.$queryRaw<Array<{ enumName: string; value: string }>>`
      SELECT type.typname AS "enumName", value.enumlabel AS value
      FROM pg_type type
      JOIN pg_enum value ON value.enumtypid = type.oid
      WHERE type.typname IN ('MembershipAssignmentLifecycle', 'MembershipAssignmentSource')
      ORDER BY type.typname, value.enumsortorder
    `
    expect(values).toEqual([
      { enumName: "MembershipAssignmentLifecycle", value: "ACTIVE" },
      { enumName: "MembershipAssignmentLifecycle", value: "SUPERSEDED" },
      { enumName: "MembershipAssignmentLifecycle", value: "REVOKED" },
      { enumName: "MembershipAssignmentSource", value: "BOOTSTRAP" },
      { enumName: "MembershipAssignmentSource", value: "AUTHENTICATION_PROVIDER" },
      { enumName: "MembershipAssignmentSource", value: "HUB_ADMINISTRATOR" },
    ])
  })

  it("keeps the authorization attempt purpose selected by the server", async () => {
    const providerRevisionId = await createProviderRevision()
    const attempt = await prisma.authorizationAttempt.create({
      data: {
        id: randomUUID(),
        providerRevisionId,
        sessionRevocationRevision: 0,
        stateDigest: "a".repeat(64),
        browserBindingDigest: "b".repeat(64),
        codeVerifierCiphertext: "encrypted",
        purpose: "SIGN_IN",
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    await expect(
      prisma.authorizationAttempt.update({
        where: { id: attempt.id },
        data: { purpose: "ADMIN_ENROLLMENT" },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.authorizationAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
        select: { purpose: true },
      }),
    ).resolves.toEqual({ purpose: "SIGN_IN" })
  })

  it("keeps the enrollment digest immutable during first consumption", async () => {
    const providerRevisionId = await createProviderRevision()
    const bootstrapSecretDigest = "c".repeat(64)
    const attempt = await prisma.authorizationAttempt.create({
      data: {
        id: randomUUID(),
        providerRevisionId,
        sessionRevocationRevision: 0,
        stateDigest: "a".repeat(64),
        browserBindingDigest: "b".repeat(64),
        codeVerifierCiphertext: "encrypted",
        purpose: "ADMIN_ENROLLMENT",
        bootstrapSecretDigest,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    const consumedAt = new Date()

    await expect(
      prisma.authorizationAttempt.update({
        where: { id: attempt.id },
        data: {
          consumedAt,
          bootstrapSecretDigest: "d".repeat(64),
        },
      }),
    ).rejects.toThrow("authority is immutable")
    await expect(
      prisma.authorizationAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
        select: { bootstrapSecretDigest: true, consumedAt: true },
      }),
    ).resolves.toEqual({
      bootstrapSecretDigest,
      consumedAt: null,
    })

    await expect(
      prisma.authorizationAttempt.update({
        where: { id: attempt.id },
        data: { consumedAt },
        select: { bootstrapSecretDigest: true, consumedAt: true },
      }),
    ).resolves.toEqual({
      bootstrapSecretDigest,
      consumedAt,
    })
  })

  it("keeps membership ownership and history while allowing lifecycle changes", async () => {
    const { firstMembershipId, secondUserId } = await createAdmissionAuthority()

    await expect(
      prisma.membership.update({
        where: { id: firstMembershipId },
        data: { userId: secondUserId },
      }),
    ).rejects.toThrow("ownership are immutable")
    await expect(
      prisma.membership.update({
        where: { id: firstMembershipId },
        data: { lifecycle: "SUSPENDED" },
      }),
    ).resolves.toMatchObject({ lifecycle: "SUSPENDED" })
    await expect(prisma.membership.delete({ where: { id: firstMembershipId } })).rejects.toThrow(
      "history cannot be deleted",
    )
  })

  it("keeps assignment ownership, provenance, role, and history", async () => {
    const { assignmentId, firstIdentityId, secondIdentityId, secondMembershipId } =
      await createAdmissionAuthority()

    await expect(
      prisma.membershipAssignment.create({
        data: {
          id: randomUUID(),
          membershipId: secondMembershipId,
          externalIdentityId: firstIdentityId,
          source: "BOOTSTRAP",
          role: "ADMINISTRATOR",
        },
      }),
    ).rejects.toThrow("must belong to the membership user")
    await expect(
      prisma.membershipAssignment.update({
        where: { id: assignmentId },
        data: { externalIdentityId: secondIdentityId },
      }),
    ).rejects.toThrow("identity and authority are immutable")
    await expect(
      prisma.$executeRaw`
        UPDATE membership_assignments
        SET role = 'MEMBER'
        WHERE id = ${assignmentId}::uuid
      `,
    ).rejects.toThrow("identity and authority are immutable")
    await expect(
      prisma.membershipAssignment.delete({ where: { id: assignmentId } }),
    ).rejects.toThrow("history cannot be deleted")
  })

  it("requires provider provenance while allowing bootstrap provenance to remain null", async () => {
    const providerRevisionId = await createProviderRevision()
    const { firstIdentityId, firstMembershipId } = await createAdmissionAuthority()

    await expect(
      prisma.$executeRaw`
        INSERT INTO membership_assignments (
          id,
          membership_id,
          external_identity_id,
          provider_revision_id,
          source,
          role,
          provider_assignment_subject
        ) VALUES (
          ${randomUUID()}::uuid,
          ${firstMembershipId}::uuid,
          ${firstIdentityId}::uuid,
          ${providerRevisionId}::uuid,
          'AUTHENTICATION_PROVIDER',
          'MEMBER',
          NULL
        )
      `,
    ).rejects.toThrow()

    await expect(
      prisma.membershipAssignment.findUniqueOrThrow({
        where: { id: (await prisma.membershipAssignment.findFirstOrThrow()).id },
        select: { providerAssignmentSubject: true, source: true },
      }),
    ).resolves.toEqual({
      providerAssignmentSubject: null,
      source: "BOOTSTRAP",
    })
  })

  it("allows one session termination while preserving session history", async () => {
    const { firstMembershipId } = await createAdmissionAuthority()
    const sessionId = randomUUID()
    await prisma.hubSession.create({
      data: {
        id: sessionId,
        membershipId: firstMembershipId,
        digest: "a".repeat(64),
        revocationRevision: 0,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    await expect(
      prisma.hubSession.update({
        where: { id: sessionId },
        data: { digest: "b".repeat(64) },
      }),
    ).rejects.toThrow("except for first termination")
    const ended = await prisma.hubSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    })
    expect(ended.id).toBe(sessionId)
    expect(ended.endedAt).toBeInstanceOf(Date)
    await expect(
      prisma.hubSession.update({
        where: { id: sessionId },
        data: { endedAt: new Date(Date.now() + 1_000) },
      }),
    ).rejects.toThrow("except for first termination")
    await expect(prisma.hubSession.delete({ where: { id: sessionId } })).rejects.toThrow(
      "history cannot be deleted",
    )
  })

  it("keeps one global revocation identity and increments its revision exactly once", async () => {
    const state = await prisma.sessionRevocationState.findUniqueOrThrow({
      where: { key: "global" },
    })

    await expect(
      prisma.sessionRevocationState.create({
        data: { id: randomUUID(), key: "extra", revision: 0 },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.sessionRevocationState.update({
        where: { id: state.id },
        data: { id: randomUUID(), revision: { increment: 1 } },
      }),
    ).rejects.toThrow("identity and history are immutable")
    await expect(
      prisma.sessionRevocationState.update({
        where: { id: state.id },
        data: { revision: { increment: 2 } },
      }),
    ).rejects.toThrow("increment exactly once")
    await expect(
      prisma.sessionRevocationState.update({
        where: { id: state.id },
        data: { revision: { increment: 1 } },
      }),
    ).resolves.toMatchObject({ key: "global", revision: 1 })
    await expect(prisma.sessionRevocationState.delete({ where: { id: state.id } })).rejects.toThrow(
      "cannot be deleted",
    )
  })
})
