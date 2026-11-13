import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { continueCopilotSensitiveAuthorization } from "."

async function createAuthorization(expectedCopilotGeneration: bigint) {
  const userId = randomUUID()
  const membershipId = randomUUID()
  const externalIdentityId = randomUUID()
  const hubSessionId = randomUUID()
  const authorizationId = randomUUID()
  await prisma.$transaction(async (transaction) => {
    await transaction.user.create({ data: { id: userId } })
    await transaction.membership.create({ data: { id: membershipId, userId } })
    await transaction.externalIdentity.create({
      data: {
        id: externalIdentityId,
        issuer: "https://github.com",
        provider: "github",
        subject: randomUUID(),
        userId,
      },
    })
    await transaction.hubSession.create({
      data: {
        digest: randomUUID().replaceAll("-", "").repeat(2),
        expiresAt: new Date(Date.now() + 60_000),
        externalIdentityId,
        id: hubSessionId,
        membershipId,
        revocationRevision: 0,
      },
    })
    await transaction.sensitiveAuthorization.create({
      data: {
        actorMembershipId: membershipId,
        expectedCopilotGeneration,
        expiresAt: new Date(Date.now() + 60_000),
        externalIdentityId,
        hubSessionId,
        id: authorizationId,
        operation: "DISCONNECT_COPILOT",
        targetMembershipIds: [membershipId],
        verifiedAt: new Date(),
      },
    })
  })
  return { authorizationId, hubSessionId, membershipId }
}

describe("continueCopilotSensitiveAuthorization()", () => {
  it("rejects an authorization after the locked Copilot generation changes", async () => {
    const state = await prisma.copilotConnectionState.findUniqueOrThrow({
      where: { key: "global" },
    })
    const authorization = await createAuthorization(state.generation)
    await prisma.copilotConnectionState.update({
      data: { generation: { increment: 1 } },
      where: { key: "global" },
    })

    await expect(
      prisma.$transaction((transaction) =>
        continueCopilotSensitiveAuthorization(transaction, {
          actorMembershipId: authorization.membershipId,
          authorizationId: authorization.authorizationId,
          hubSessionId: authorization.hubSessionId,
          operation: "DISCONNECT_COPILOT",
        }),
      ),
    ).resolves.toBe(false)
  })

  it("preserves sensitive authorization creation time as immutable history", async () => {
    const state = await prisma.copilotConnectionState.findUniqueOrThrow({
      where: { key: "global" },
    })
    const authorization = await createAuthorization(state.generation)

    await expect(
      prisma.$executeRaw`
        UPDATE "sensitive_authorizations"
        SET "created_at" = "created_at" - interval '1 second',
            "updated_at" = clock_timestamp()
        WHERE "id" = ${authorization.authorizationId}::uuid
      `,
    ).rejects.toThrow("Sensitive authorization binding and completed transitions are immutable.")
  })
})
