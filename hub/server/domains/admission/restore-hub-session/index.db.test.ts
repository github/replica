import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { restoreHubSession } from "."
import { runSessionRestoreTransaction } from "../run-session-restore-transaction"

async function createSessionAuthority(input: {
  bootstrap?: boolean
  selectedRevision: "assignment" | "newer"
}) {
  const providerId = randomUUID()
  const assignmentRevisionId = randomUUID()
  const newerRevisionId = randomUUID()
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  const digest = "a".repeat(64)
  await prisma.$transaction(async (transaction) => {
    await transaction.authenticationProvider.create({
      data: { id: providerId, key: "entra" },
    })
    await transaction.authenticationProviderRevision.createMany({
      data: [
        {
          configurationDigest: "b".repeat(64),
          id: assignmentRevisionId,
          providerId,
          revision: 1,
        },
        {
          configurationDigest: "c".repeat(64),
          id: newerRevisionId,
          providerId,
          revision: 2,
        },
      ],
    })
    await transaction.authenticationProvider.update({
      data: {
        selectedRevisionId:
          input.selectedRevision === "assignment" ? assignmentRevisionId : newerRevisionId,
      },
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
    await transaction.membershipAssignment.create({
      data: {
        externalIdentityId,
        id: randomUUID(),
        membershipId,
        providerAssignmentSubject: "22222222-2222-4222-8222-222222222222",
        providerRevisionId: assignmentRevisionId,
        role: "MEMBER",
        source: "AUTHENTICATION_PROVIDER",
      },
    })
    if (input.bootstrap) {
      await transaction.membershipAssignment.create({
        data: {
          externalIdentityId,
          id: randomUUID(),
          membershipId,
          role: "ADMINISTRATOR",
          source: "BOOTSTRAP",
        },
      })
    }
    await transaction.hubSession.create({
      data: {
        digest,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        id: randomUUID(),
        membershipId,
        revocationRevision: 0,
      },
    })
  })
  return digest
}

function restore(digest: string) {
  return restoreHubSession(digest, {
    runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
  })
}

describe("restoreHubSession()", () => {
  it("denies a session whose provider assignment uses a stale revision", async () => {
    const digest = await createSessionAuthority({ selectedRevision: "newer" })

    await expect(restore(digest)).resolves.toBeNull()
  })

  it("restores a session whose provider assignment uses the selected revision", async () => {
    const digest = await createSessionAuthority({ selectedRevision: "assignment" })

    await expect(restore(digest)).resolves.toEqual({ role: "MEMBER" })
  })

  it("restores through bootstrap authority when provider authority is stale", async () => {
    const digest = await createSessionAuthority({
      bootstrap: true,
      selectedRevision: "newer",
    })

    await expect(restore(digest)).resolves.toEqual({ role: "ADMINISTRATOR" })
  })
})
