import { randomBytes, randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import type { Prisma } from "../../generated/prisma/client"
import { deferred } from "../../../test/ws/deferred"
import { getDatabaseUrl } from "../../../test/database/get-database-url"
import { waitForDatabaseLock } from "../../../test/database/wait-for-database-lock"
import { withFailingSecurityAudit } from "../../../test/database/with-failing-security-audit"
import { LearningCommandError } from "../../integrations/learning/run-learning-command/errors"
import { prisma } from "../../integrations/prisma"
import { advanceCopilotConnectionState } from "../../repositories/copilot-connection-states/advance-copilot-connection-state"
import { clearCopilotCredentialRefusal } from "../../repositories/copilot-connection-states/clear-copilot-credential-refusal"
import { lockCopilotConnectionState } from "../../repositories/copilot-connection-states/lock-copilot-connection-state"
import { recordCopilotCredentialRefusal } from "../../repositories/copilot-connection-states/record-copilot-credential-refusal"
import { deleteCopilotConnection } from "../../repositories/copilot-connections/delete-copilot-connection"
import { getCopilotConnection } from "../../repositories/copilot-connections/get-copilot-connection"
import { replaceCopilotConnection } from "../../repositories/copilot-connections/replace-copilot-connection"
import { findAdministratorHubSession } from "../../repositories/hub-sessions/find-administrator-hub-session"
import { lockAdministratorHubSession } from "../../repositories/hub-sessions/lock-administrator-hub-session"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { connectCopilot } from "./connect-copilot"
import { disconnectCopilot } from "./disconnect-copilot"
import { readCopilotConnectionSnapshot } from "./read-copilot-connection-snapshot"
import { recordCopilotConnectionFailure } from "./record-copilot-connection-failure"
import { recordCopilotConnectionRefusal } from "./record-copilot-connection-refusal"
import { runCopilotConnectionTransaction } from "./run-copilot-connection-transaction"
import type { CopilotConnectionTransactionRepositories } from "./types"

async function createConnection() {
  const userId = randomUUID()
  const membershipId = randomUUID()
  const connectionId = randomUUID()
  await prisma.user.create({ data: { id: userId } })
  await prisma.membership.create({ data: { id: membershipId, userId } })
  await prisma.copilotConnection.create({
    data: {
      connectedByMembershipId: membershipId,
      credentialDigest: "a".repeat(64),
      credentialProvider: "environment_token",
      id: connectionId,
      key: "global",
      verifiedAt: new Date("2026-11-10T23:00:00Z"),
    },
  })
  return { connectionId, membershipId }
}

async function createAdministratorConnection() {
  const providerId = randomUUID()
  const providerRevisionId = randomUUID()
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  const assignmentId = randomUUID()
  const connectionId = randomUUID()
  const sessionId = randomUUID()
  const sessionDigest = randomBytes(32).toString("hex")
  await prisma.$transaction(async (transaction) => {
    await transaction.authenticationProvider.create({
      data: { enabled: false, id: providerId, key: "github" },
    })
    await transaction.authenticationProviderRevision.create({
      data: {
        configurationDigest: "c".repeat(64),
        id: providerRevisionId,
        providerId,
        revision: 1,
      },
    })
    await transaction.authenticationProvider.update({
      data: { enabled: true, selectedRevisionId: providerRevisionId },
      where: { id: providerId },
    })
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
        id: assignmentId,
        membershipId,
        role: "ADMINISTRATOR",
        source: "HUB_ADMINISTRATOR",
      },
    })
    await transaction.hubSession.create({
      data: {
        digest: sessionDigest,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        externalIdentityId,
        id: sessionId,
        membershipId,
        providerRevisionId,
        revocationRevision: 0,
      },
    })
    await transaction.copilotConnection.create({
      data: {
        connectedByMembershipId: membershipId,
        credentialDigest: "a".repeat(64),
        credentialProvider: "environment_token",
        id: connectionId,
        key: "global",
        verifiedAt: new Date("2026-11-10T23:00:00Z"),
      },
    })
  })
  return { assignmentId, connectionId, membershipId, sessionDigest, sessionId }
}

function transactionRepositories(
  transaction: Prisma.TransactionClient,
): CopilotConnectionTransactionRepositories {
  return {
    advanceState: () => advanceCopilotConnectionState(transaction),
    clearRefusal: () => clearCopilotCredentialRefusal(transaction),
    deleteConnection: () => deleteCopilotConnection(transaction),
    getConnection: () => getCopilotConnection(transaction),
    lockAdministratorSession: (digest) => lockAdministratorHubSession(transaction, digest),
    lockState: () => lockCopilotConnectionState(transaction),
    recordRefusal: (input) => recordCopilotCredentialRefusal(transaction, input),
    replaceConnection: (input) => replaceCopilotConnection(transaction, input),
    writeAudit: (event) => createSecurityAudit(transaction, event),
  }
}

describe("Copilot connection persistence", () => {
  it("records a rotated credential refusal without rewriting the verified connection", async () => {
    const { connectionId, membershipId } = await createConnection()
    const refusedAt = new Date("2026-11-12T12:00:00Z")

    await expect(
      recordCopilotConnectionRefusal(
        {
          at: refusedAt,
          credentialDigest: "b".repeat(64),
          credentialProvider: "environment_token",
          sessionDigest: "session-digest",
          snapshot: { connectionId, generation: 0n },
        },
        {
          createId: randomUUID,
          runTransaction: (operation) =>
            runCopilotConnectionTransaction(
              prisma,
              (transaction) => ({
                advanceState: () => advanceCopilotConnectionState(transaction),
                clearRefusal: () => clearCopilotCredentialRefusal(transaction),
                deleteConnection: () => deleteCopilotConnection(transaction),
                lockAdministratorSession: () => Promise.resolve({ membershipId }),
                getConnection: () => getCopilotConnection(transaction),
                lockState: () => lockCopilotConnectionState(transaction),
                recordRefusal: (input) => recordCopilotCredentialRefusal(transaction, input),
                replaceConnection: (input) => replaceCopilotConnection(transaction, input),
                writeAudit: (event) => createSecurityAudit(transaction, event),
              }),
              operation,
            ),
        },
      ),
    ).resolves.toBe("recorded")

    await expect(
      prisma.copilotConnection.findUniqueOrThrow({
        where: { key: "global" },
        select: { credentialDigest: true, credentialProvider: true, verifiedAt: true },
      }),
    ).resolves.toMatchObject({
      credentialDigest: "a".repeat(64),
      credentialProvider: "environment_token",
      verifiedAt: new Date("2026-11-10T23:00:00Z"),
    })
    await expect(
      prisma.copilotConnectionState.findUniqueOrThrow({
        where: { key: "global" },
        select: {
          generation: true,
          refusedAt: true,
          refusedCredentialDigest: true,
          refusedCredentialProvider: true,
        },
      }),
    ).resolves.toEqual({
      generation: 1n,
      refusedAt,
      refusedCredentialDigest: "b".repeat(64),
      refusedCredentialProvider: "environment_token",
    })
  })

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

  it("waits for session revocation authority before locking the administrator session", async () => {
    const records = await createAdministratorConnection()
    const locker = new pg.Client({ connectionString: getDatabaseUrl() })
    await locker.connect()
    let lockerOpen = false
    let sessionLock: Promise<unknown> | null = null

    try {
      await locker.query("BEGIN")
      lockerOpen = true
      await locker.query(
        `SELECT revision FROM session_revocation_states WHERE key = 'global' FOR UPDATE`,
      )
      sessionLock = prisma.$transaction((transaction) =>
        lockAdministratorHubSession(transaction, records.sessionDigest),
      )
      const sessionLockResult = sessionLock.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      )
      await waitForDatabaseLock(getDatabaseUrl())

      await locker.query(`SELECT id FROM hub_sessions WHERE id = $1 FOR UPDATE NOWAIT`, [
        records.sessionId,
      ])
      await locker.query("COMMIT")
      lockerOpen = false

      await expect(sessionLockResult).resolves.toMatchObject({
        status: "fulfilled",
        value: { id: records.sessionId },
      })
    } finally {
      if (lockerOpen) {
        await locker.query("ROLLBACK")
      }
      if (sessionLock) {
        await Promise.allSettled([sessionLock])
      }
      await locker.end()
    }
  })

  it.each(["connect", "disconnect", "refusal", "failure"] as const)(
    "rejects %s when administrator authority is revoked while the state lock is waited on",
    async (operation) => {
      const records = await createAdministratorConnection()
      function runTransaction<T>(
        work: (repositories: CopilotConnectionTransactionRepositories) => Promise<T>,
      ) {
        return runCopilotConnectionTransaction(prisma, transactionRepositories, work)
      }
      function connect(check: () => Promise<unknown>) {
        return connectCopilot(
          {
            credentialProvider: {
              configurationDigest: "a".repeat(64),
              key: "environment_token",
            },
            sessionDigest: records.sessionDigest,
          },
          {
            check,
            createId: randomUUID,
            findAdministratorSession: (digest) => findAdministratorHubSession(prisma, digest),
            now: () => new Date("2026-11-12T12:00:00Z"),
            readSnapshot: () =>
              readCopilotConnectionSnapshot({
                getConnection: () => getCopilotConnection(prisma),
                getState: () =>
                  prisma.copilotConnectionState.findUnique({ where: { key: "global" } }),
              }),
            recordFailure: (input) =>
              recordCopilotConnectionFailure(input, { createId: randomUUID, runTransaction }),
            recordRefusal: (input) =>
              recordCopilotConnectionRefusal(input, { createId: randomUUID, runTransaction }),
            runTransaction,
            writeAudit: (event) => createSecurityAudit(prisma, event),
          },
        )
      }
      const mutation =
        operation === "disconnect"
          ? () =>
              disconnectCopilot(
                { sessionDigest: records.sessionDigest },
                { createId: randomUUID, runTransaction },
              )
          : operation === "refusal"
            ? () =>
                connect(() =>
                  Promise.reject(
                    new LearningCommandError("unauthorized", "Copilot refused the credential."),
                  ),
                )
            : operation === "failure"
              ? () => connect(() => Promise.reject(new Error("Copilot unavailable")))
              : () => connect(() => Promise.resolve({ signedIn: true, login: null, models: [] }))
      const locker = new pg.Client({ connectionString: getDatabaseUrl() })
      await locker.connect()
      try {
        await locker.query("BEGIN")
        await locker.query(
          `SELECT key FROM copilot_connection_states WHERE key = 'global' FOR UPDATE`,
        )
        const result = mutation()
        void result.catch(() => {})
        await waitForDatabaseLock(getDatabaseUrl())
        await prisma.membershipAssignment.update({
          data: { lifecycle: "REVOKED", updatedAt: new Date("2098-01-01T00:00:00Z") },
          where: { id: records.assignmentId },
        })
        await locker.query("COMMIT")

        await expect(result).rejects.toBeInstanceOf(Error)
      } finally {
        await Promise.allSettled([locker.query("ROLLBACK")])
        await locker.end()
      }

      await expect(
        prisma.copilotConnection.findUniqueOrThrow({
          where: { key: "global" },
          select: { id: true },
        }),
      ).resolves.toEqual({ id: records.connectionId })
      await expect(
        prisma.copilotConnectionState.findUniqueOrThrow({
          where: { key: "global" },
          select: { generation: true, refusedAt: true },
        }),
      ).resolves.toEqual({ generation: 0n, refusedAt: null })
      await expect(prisma.securityAudit.count()).resolves.toBe(0)
    },
  )

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
                  clearRefusal: () => clearCopilotCredentialRefusal(transaction),
                  deleteConnection: () => deleteCopilotConnection(transaction),
                  lockAdministratorSession: () => Promise.resolve({ membershipId }),
                  getConnection: () => getCopilotConnection(transaction),
                  lockState: () => lockCopilotConnectionState(transaction),
                  replaceConnection: (input) => replaceCopilotConnection(transaction, input),
                  recordRefusal: (input) => recordCopilotCredentialRefusal(transaction, input),
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
