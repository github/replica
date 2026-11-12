import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { reconcileAuthenticationProviders } from "../../../domains/identity/reconcile-authentication-providers"
import { runProviderRevisionTransaction } from "../../../domains/identity/run-provider-revision-transaction"
import { prisma } from "../../../integrations/prisma"
import { createSecurityAudit } from "../../security-audits/create-security-audit"

function providerCandidate(revision: number) {
  return {
    canonicalPublicConfiguration: JSON.stringify({ clientId: `github-client-${revision}` }),
    providerKey: "github",
    revision,
  }
}

function reconcile(revision: number | null) {
  return reconcileAuthenticationProviders(revision === null ? [] : [providerCandidate(revision)], {
    createId: randomUUID,
    runTransaction: (operation) => runProviderRevisionTransaction(prisma, operation),
    writeAudit: (event) => createSecurityAudit(prisma, event),
  })
}

async function createConnectedProviderAdministrator(withIndependentAdministratorSource = false) {
  const [provider] = await reconcile(1)
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  await prisma.$transaction(async (transaction) => {
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
        id: randomUUID(),
        membershipId,
        providerAssignmentSubject: randomUUID(),
        providerRevisionId: provider!.revisionId,
        role: "ADMINISTRATOR",
        source: "AUTHENTICATION_PROVIDER",
      },
    })
    if (withIndependentAdministratorSource) {
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
    await transaction.copilotConnectionState.update({
      data: {
        connectedByMembershipId: membershipId,
        generation: 7n,
        tokenDigest: "a".repeat(64),
        verifiedAt: new Date(),
      },
      where: { key: "global" },
    })
  })
  return { membershipId, provider }
}

async function expectAutomaticDisconnection(membershipId: string) {
  await expect(
    prisma.copilotConnectionState.findUniqueOrThrow({
      select: {
        connectedByMembershipId: true,
        generation: true,
        tokenDigest: true,
        verifiedAt: true,
      },
      where: { key: "global" },
    }),
  ).resolves.toEqual({
    connectedByMembershipId: null,
    generation: 8n,
    tokenDigest: null,
    verifiedAt: null,
  })
  await expect(
    prisma.securityAudit.findFirstOrThrow({
      select: { action: true, context: true, outcome: true },
      where: { action: "copilot.connection.disconnect" },
    }),
  ).resolves.toEqual({
    action: "copilot.connection.disconnect",
    context: {
      actorMembershipId: null,
      connectorMembershipId: membershipId,
      operation: "disconnect",
      reason: "connector_role_removed",
    },
    outcome: "SUCCESS",
  })
}

describe("disconnectCopilotConnectionWithoutEffectiveAdministrator()", () => {
  it("disconnects after provider removal returns no configured providers", async () => {
    const { membershipId } = await createConnectedProviderAdministrator()

    await expect(reconcile(null)).resolves.toEqual([])

    await expectAutomaticDisconnection(membershipId)
  })

  it("disconnects when revision replacement makes the connector's provider assignment stale", async () => {
    const { membershipId, provider } = await createConnectedProviderAdministrator()

    await expect(reconcile(2)).resolves.toEqual([
      expect.objectContaining({
        providerId: provider!.providerId,
        providerKey: "github",
        revision: 2,
      }),
    ])

    await expectAutomaticDisconnection(membershipId)
  })

  it("preserves the connection when provider removal leaves an independent administrator source", async () => {
    const { membershipId } = await createConnectedProviderAdministrator(true)

    await expect(reconcile(null)).resolves.toEqual([])

    await expect(
      prisma.copilotConnectionState.findUniqueOrThrow({
        select: {
          connectedByMembershipId: true,
          generation: true,
          tokenDigest: true,
        },
        where: { key: "global" },
      }),
    ).resolves.toEqual({
      connectedByMembershipId: membershipId,
      generation: 7n,
      tokenDigest: "a".repeat(64),
    })
    await expect(
      prisma.securityAudit.count({
        where: { action: "copilot.connection.disconnect" },
      }),
    ).resolves.toBe(0)
  })
})
