import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { deferred } from "../../../test/ws/deferred"
import { getDatabaseUrl } from "../../../test/database/get-database-url"
import { waitForDatabaseLock } from "../../../test/database/wait-for-database-lock"
import { withFailingSecurityAudit } from "../../../test/database/with-failing-security-audit"
import { prisma } from "../../integrations/prisma"
import { advanceCopilotConnectionState } from "../../repositories/copilot-connection-states/advance-copilot-connection-state"
import { lockCopilotConnectionState } from "../../repositories/copilot-connection-states/lock-copilot-connection-state"
import { deleteCopilotConnection } from "../../repositories/copilot-connections/delete-copilot-connection"
import { getCopilotConnection } from "../../repositories/copilot-connections/get-copilot-connection"
import { replaceCopilotConnection } from "../../repositories/copilot-connections/replace-copilot-connection"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { disconnectCopilot } from "./disconnect-copilot"
import { runCopilotConnectionTransaction } from "./run-copilot-connection-transaction"

async function createConnection() {
  const userId = randomUUID()
  const membershipId = randomUUID()
  const connectionId = randomUUID()
  await prisma.user.create({ data: { id: userId } })
  await prisma.membership.create({ data: { id: membershipId, userId } })
  await prisma.copilotConnection.create({
    data: {
      connectedByMembershipId: membershipId,
      id: connectionId,
      key: "global",
      tokenDigest: "a".repeat(64),
      verifiedAt: new Date("2026-11-10T23:00:00Z"),
    },
  })
  return { connectionId, membershipId }
}

describe("Copilot connection persistence", () => {
  it("holds the state lock until the current mutation completes", async () => {
    const entered = deferred<void>()
    const finish = deferred<void>()
    let competingMutationCompleted = false
    const lockingMutation = prisma.$transaction(async (transaction) => {
      await lockCopilotConnectionState(transaction)
      entered.resolve()
      await finish.promise
    })
    void lockingMutation.catch(() => {})

    try {
      await entered.promise
      const competingMutation = advanceCopilotConnectionState(prisma).then(() => {
        competingMutationCompleted = true
      })
      void competingMutation.catch(() => {})
      await waitForDatabaseLock(getDatabaseUrl())
      expect(competingMutationCompleted).toBe(false)

      finish.resolve()
      await Promise.all([lockingMutation, competingMutation])
      await expect(
        prisma.copilotConnectionState.findUniqueOrThrow({
          where: { key: "global" },
          select: { generation: true },
        }),
      ).resolves.toEqual({ generation: 1n })
    } finally {
      finish.resolve()
      await lockingMutation.catch(() => {})
    }
  })

  it("rolls back the deleted connection and generation when its success audit fails", async () => {
    const { connectionId, membershipId } = await createConnection()

    await withFailingSecurityAudit("copilot.connection.disconnected", () =>
      expect(
        disconnectCopilot(
          { sessionDigest: "session-digest" },
          {
            createId: randomUUID,
            runTransaction: (operation) =>
              runCopilotConnectionTransaction(
                prisma,
                (transaction) => ({
                  advanceState: () => advanceCopilotConnectionState(transaction),
                  deleteConnection: () => deleteCopilotConnection(transaction),
                  findAdministratorSession: () => Promise.resolve({ membershipId }),
                  getConnection: () => getCopilotConnection(transaction),
                  lockState: () => lockCopilotConnectionState(transaction),
                  replaceConnection: (input) => replaceCopilotConnection(transaction, input),
                  refuseConnection: () => Promise.resolve(false),
                  writeAudit: (event) => createSecurityAudit(transaction, event),
                }),
                operation,
              ),
          },
        ),
      ).rejects.toThrow("security audit unavailable"),
    )

    await expect(
      prisma.copilotConnection.findUnique({ where: { key: "global" }, select: { id: true } }),
    ).resolves.toEqual({ id: connectionId })
    await expect(
      prisma.copilotConnectionState.findUniqueOrThrow({
        where: { key: "global" },
        select: { generation: true },
      }),
    ).resolves.toEqual({ generation: 0n })
    await expect(prisma.securityAudit.count()).resolves.toBe(0)
  })
})
