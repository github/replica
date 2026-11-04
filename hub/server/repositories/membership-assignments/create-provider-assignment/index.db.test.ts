import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { endProviderAssignment } from "../end-provider-assignment"
import { createProviderAssignment } from "."

async function createAuthorityRecords() {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
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
  })
  return { externalIdentityId, membershipId, providerRevisionId }
}

describe("createProviderAssignment()", () => {
  it("keeps one active immutable version and permits a replacement after supersession", async () => {
    const records = await createAuthorityRecords()
    const firstId = randomUUID()
    const providerAssignmentSubject = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"

    await expect(
      createProviderAssignment(prisma, {
        ...records,
        id: firstId,
        providerAssignmentSubject,
        role: "MEMBER",
      }),
    ).resolves.toBe(true)
    await expect(
      createProviderAssignment(prisma, {
        ...records,
        id: randomUUID(),
        providerAssignmentSubject,
        role: "ADMINISTRATOR",
      }),
    ).resolves.toBe(false)

    await endProviderAssignment(prisma, {
      id: firstId,
      lifecycle: "SUPERSEDED",
    })
    const replacementId = randomUUID()
    await expect(
      createProviderAssignment(prisma, {
        ...records,
        id: replacementId,
        providerAssignmentSubject,
        role: "ADMINISTRATOR",
      }),
    ).resolves.toBe(true)

    const assignments = await prisma.membershipAssignment.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        lifecycle: true,
        providerAssignmentSubject: true,
        role: true,
      },
    })
    expect(assignments).toEqual([
      {
        id: firstId,
        lifecycle: "SUPERSEDED",
        providerAssignmentSubject: providerAssignmentSubject.toLowerCase(),
        role: "MEMBER",
      },
      {
        id: replacementId,
        lifecycle: "ACTIVE",
        providerAssignmentSubject: providerAssignmentSubject.toLowerCase(),
        role: "ADMINISTRATOR",
      },
    ])
  })
})
