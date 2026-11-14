import { createHash, randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { getDatabaseUrl } from "../../../test/database/get-database-url"
import { continueAdministratorAuthorization } from "../administrator-authorization/continue-administrator-authorization"
import { disconnectCopilot } from "../copilot-connection/disconnect-copilot"
import { runCopilotConnectionTransaction } from "../copilot-connection/run-copilot-connection-transaction"
import { advanceCopilotConnectionState } from "../../repositories/copilot-connection-states/advance-copilot-connection-state"
import { clearCopilotCredentialRefusal } from "../../repositories/copilot-connection-states/clear-copilot-credential-refusal"
import { lockCopilotConnectionState } from "../../repositories/copilot-connection-states/lock-copilot-connection-state"
import { recordCopilotCredentialRefusal } from "../../repositories/copilot-connection-states/record-copilot-credential-refusal"
import { deleteCopilotConnection } from "../../repositories/copilot-connections/delete-copilot-connection"
import { getCopilotConnection } from "../../repositories/copilot-connections/get-copilot-connection"
import { replaceCopilotConnection } from "../../repositories/copilot-connections/replace-copilot-connection"
import { lockAdministratorHubSession } from "../../repositories/hub-sessions/lock-administrator-hub-session"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { runAdmissionTransaction } from "./run-admission-transaction"
import { restoreHubSession } from "./restore-hub-session"
import { runSessionRestoreTransaction } from "./run-session-restore-transaction"

async function observeBlocked(inspector: pg.Client, pid: number, query?: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await inspector.query<{ pid: number }>(
      `SELECT waiter.pid FROM pg_stat_activity waiter
       WHERE waiter.datname = current_database()
         AND waiter.wait_event_type = 'Lock'
         AND (
           ($2::text IS NULL AND waiter.pid = $1)
           OR (waiter.query LIKE $2 AND $1 = ANY(pg_blocking_pids(waiter.pid)))
         )
       LIMIT 1`,
      [pid, query ? `%${query}%` : null],
    )
    if (result.rows[0]?.pid) return result.rows[0].pid
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for database lock: ${query ?? pid}.`)
}

function barrier() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { release, wait }
}

async function createProvider() {
  const providerId = randomUUID()
  const revisionId = randomUUID()
  await prisma.$transaction(async (transaction) => {
    await transaction.authenticationProvider.create({
      data: { id: providerId, key: "github" },
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
  return { providerId, revisionId }
}

describe("admission authority locks", () => {
  async function serializesMutationWithRestore(
    source: "BOOTSTRAP" | "HUB_ADMINISTRATOR",
    mutation: "administrator continuation" | "Copilot disconnect",
  ) {
    const { revisionId } = await createProvider()
    const userId = randomUUID()
    const membershipId = randomUUID()
    const externalIdentityId = randomUUID()
    const sessionId = randomUUID()
    const digest = createHash("sha256").update(randomUUID()).digest("hex")
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
    await prisma.membership.create({ data: { id: membershipId, userId } })
    await prisma.membershipAssignment.create({
      data: { externalIdentityId, membershipId, role: "ADMINISTRATOR", source },
    })
    const { revision } = await prisma.sessionRevocationState.findUniqueOrThrow({
      where: { key: "global" },
    })
    await prisma.hubSession.create({
      data: {
        digest,
        expiresAt: new Date(Date.now() + 60_000),
        externalIdentityId,
        id: sessionId,
        membershipId,
        providerRevisionId: revisionId,
        revocationRevision: revision,
      },
    })
    const authorizationId = randomUUID()
    const targetMembershipId = randomUUID()
    if (mutation === "administrator continuation") {
      const targetUserId = randomUUID()
      await prisma.user.create({ data: { id: targetUserId } })
      await prisma.externalIdentity.create({
        data: {
          issuer: "https://github.com",
          provider: "github",
          subject: randomUUID(),
          userId: targetUserId,
        },
      })
      await prisma.membership.create({
        data: { id: targetMembershipId, userId: targetUserId },
      })
      await prisma.sensitiveAuthorization.create({
        data: {
          actorMembershipId: membershipId,
          expiresAt: new Date(Date.now() + 60_000),
          externalIdentityId,
          hubSessionId: sessionId,
          id: authorizationId,
          operation: "DESIGNATE_ADMINISTRATORS",
          targetMembershipIds: [targetMembershipId],
          verifiedAt: new Date(),
        },
      })
    } else {
      await prisma.copilotConnection.create({
        data: {
          connectedByMembershipId: membershipId,
          credentialDigest: "b".repeat(64),
          credentialProvider: "environment_token",
          key: "global",
          verifiedAt: new Date(),
        },
      })
    }

    const sessionHolder = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([sessionHolder.connect(), inspector.connect()])
    let holderOpen = false
    let restoration: ReturnType<typeof restoreHubSession> | null = null
    let change: Promise<unknown> | null = null
    try {
      await sessionHolder.query("BEGIN")
      holderOpen = true
      await sessionHolder.query("SELECT id FROM hub_sessions WHERE id = $1 FOR UPDATE", [sessionId])
      const { pid } = (await sessionHolder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
        .rows[0]!
      restoration = restoreHubSession(digest, {
        runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
      })
      void restoration.catch(() => {})
      // Restoration now owns membership authority but cannot finish its session lock.
      const restorePid = await observeBlocked(inspector, pid, "hub_sessions")
      change =
        mutation === "administrator continuation"
          ? continueAdministratorAuthorization(prisma, {
              hubSessionId: sessionId,
              id: authorizationId,
              operation: "DESIGNATE_ADMINISTRATORS",
              targetMembershipIds: [targetMembershipId],
            })
          : disconnectCopilot(
              { sessionDigest: digest },
              {
                createId: randomUUID,
                runTransaction: (operation) =>
                  runCopilotConnectionTransaction(
                    prisma,
                    (transaction) => ({
                      advanceState: () => advanceCopilotConnectionState(transaction),
                      clearRefusal: () => clearCopilotCredentialRefusal(transaction),
                      deleteConnection: () => deleteCopilotConnection(transaction),
                      getConnection: () => getCopilotConnection(transaction),
                      lockAdministratorSession: (value) =>
                        lockAdministratorHubSession(transaction, value),
                      lockState: () => lockCopilotConnectionState(transaction),
                      recordRefusal: (input) => recordCopilotCredentialRefusal(transaction, input),
                      replaceConnection: (input) => replaceCopilotConnection(transaction, input),
                      writeAudit: (event) => createSecurityAudit(transaction, event),
                    }),
                    operation,
                  ),
              },
            )
      void change.catch(() => {})
      await observeBlocked(inspector, restorePid, 'FROM "session_revocation_states"')
      await sessionHolder.query("COMMIT")
      holderOpen = false
      await expect(restoration).resolves.toMatchObject({ membershipId, role: "ADMINISTRATOR" })
      if (mutation === "administrator continuation") {
        await expect(change).resolves.toMatchObject([{ membershipId: targetMembershipId }])
        expect(
          await prisma.sensitiveAuthorization.findUniqueOrThrow({
            where: { id: authorizationId },
          }),
        ).toHaveProperty("continuedAt", expect.any(Date))
      } else {
        await expect(change).resolves.toEqual({ disconnected: true })
        expect(await prisma.copilotConnection.count()).toBe(0)
      }
    } finally {
      if (holderOpen) await sessionHolder.query("ROLLBACK")
      await Promise.allSettled([restoration, change])
      await Promise.all([sessionHolder.end(), inspector.end()])
    }
  }

  it("serializes administrator continuation behind a bootstrap-only restoration", async () => {
    await serializesMutationWithRestore("BOOTSTRAP", "administrator continuation")
  })

  it("serializes Copilot disconnect behind an administrator-only restoration", async () => {
    await serializesMutationWithRestore("HUB_ADMINISTRATOR", "Copilot disconnect")
  })

  it("locks a session provider before checking its revocation revision", async () => {
    const { providerId, revisionId } = await createProvider()
    const userId = randomUUID()
    const externalIdentityId = randomUUID()
    const membershipId = randomUUID()
    const subject = randomUUID()
    const token = randomUUID()
    await prisma.user.create({ data: { id: userId } })
    await prisma.externalIdentity.create({
      data: {
        id: externalIdentityId,
        issuer: "https://github.com",
        provider: "github",
        subject,
        userId,
      },
    })
    await prisma.membership.create({ data: { id: membershipId, userId } })
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId,
        membershipId,
        providerAssignmentSubject: subject,
        providerRevisionId: revisionId,
        role: "MEMBER",
        source: "AUTHENTICATION_PROVIDER",
      },
    })
    const { revision } = await prisma.sessionRevocationState.findUniqueOrThrow({
      select: { revision: true },
      where: { key: "global" },
    })
    const digest = createHash("sha256").update(token).digest("hex")
    await prisma.hubSession.create({
      data: {
        digest,
        expiresAt: new Date(Date.now() + 60_000),
        externalIdentityId,
        membershipId,
        providerRevisionId: revisionId,
        revocationRevision: revision,
      },
    })

    const providerHolder = new pg.Client({ connectionString: getDatabaseUrl() })
    const revocationHolder = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([providerHolder.connect(), revocationHolder.connect(), inspector.connect()])
    let providerTransactionOpen = false
    let revocationTransactionOpen = false
    let restoration: Promise<unknown> | null = null
    try {
      const { pid: providerPid } = (
        await providerHolder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      const { pid: revocationPid } = (
        await revocationHolder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      await providerHolder.query("BEGIN")
      providerTransactionOpen = true
      await providerHolder.query(
        "SELECT id FROM authentication_providers WHERE id = $1 FOR UPDATE",
        [providerId],
      )
      await revocationHolder.query("BEGIN")
      revocationTransactionOpen = true
      await revocationHolder.query(
        "SELECT revision FROM session_revocation_states WHERE key = 'global' FOR UPDATE",
      )
      restoration = restoreHubSession(digest, {
        runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
      })
      await observeBlocked(inspector, providerPid, "authentication_providers")

      await providerHolder.query("COMMIT")
      providerTransactionOpen = false
      await observeBlocked(inspector, revocationPid, "session_revocation_states")
      await revocationHolder.query(
        `UPDATE session_revocation_states
         SET revision = revision + 1, updated_at = clock_timestamp()
         WHERE key = 'global'`,
      )
      await revocationHolder.query("COMMIT")
      revocationTransactionOpen = false
      await expect(restoration).resolves.toBeNull()
    } finally {
      if (providerTransactionOpen) await providerHolder.query("ROLLBACK")
      if (revocationTransactionOpen) await revocationHolder.query("ROLLBACK")
      if (restoration) await Promise.allSettled([restoration])
      await Promise.all([providerHolder.end(), revocationHolder.end(), inspector.end()])
    }
  })

  it("allows production admission authority locks to overlap while provider mutation waits", async () => {
    const { providerId, revisionId } = await createProvider()
    const updater = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([updater.connect(), inspector.connect()])
    const firstBarrier = barrier()
    const secondBarrier = barrier()
    let firstLocked!: () => void
    const firstReady = new Promise<void>((resolve) => {
      firstLocked = resolve
    })
    let secondLocked!: () => void
    const secondReady = new Promise<void>((resolve) => {
      secondLocked = resolve
    })
    try {
      const firstAdmission = runAdmissionTransaction(prisma, async (repositories) => {
        await expect(repositories.lockProvider("github")).resolves.toEqual({
          enabled: true,
          selectedRevisionId: revisionId,
        })
        await expect(repositories.lockRevocation()).resolves.toMatchObject({ revision: 0 })
        firstLocked()
        await firstBarrier.wait
      })
      await firstReady
      const secondAdmission = runAdmissionTransaction(prisma, async (repositories) => {
        await expect(repositories.lockProvider("github")).resolves.toEqual({
          enabled: true,
          selectedRevisionId: revisionId,
        })
        await expect(repositories.lockRevocation()).resolves.toMatchObject({ revision: 0 })
        secondLocked()
        await secondBarrier.wait
      })
      await secondReady

      const updaterPid = await updater.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`)
      await updater.query("BEGIN")
      const update = updater.query(
        `UPDATE authentication_providers
         SET updated_at = clock_timestamp()
         WHERE id = $1`,
        [providerId],
      )
      await observeBlocked(inspector, updaterPid.rows[0]!.pid)

      firstBarrier.release()
      secondBarrier.release()
      await Promise.all([firstAdmission, secondAdmission])
      await expect(update).resolves.toHaveProperty("rowCount", 1)
      await updater.query("COMMIT")
    } finally {
      firstBarrier.release()
      secondBarrier.release()
      await Promise.allSettled([updater.query("ROLLBACK")])
      await Promise.all([updater.end(), inspector.end()])
    }
  })

  it("makes revocation mutation wait for production admission authority locks", async () => {
    await createProvider()
    const updater = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([updater.connect(), inspector.connect()])
    const admissionBarrier = barrier()
    let authorityLocked!: () => void
    const authorityReady = new Promise<void>((resolve) => {
      authorityLocked = resolve
    })
    try {
      const admission = runAdmissionTransaction(prisma, async (repositories) => {
        await expect(repositories.lockProvider("github")).resolves.not.toBeNull()
        await expect(repositories.lockRevocation()).resolves.toMatchObject({ revision: 0 })
        authorityLocked()
        await admissionBarrier.wait
      })
      await authorityReady

      const updaterPid = await updater.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`)
      await updater.query("BEGIN")
      const update = updater.query(
        `UPDATE session_revocation_states
         SET revision = revision + 1, updated_at = clock_timestamp()
         WHERE key = 'global'`,
      )
      await observeBlocked(inspector, updaterPid.rows[0]!.pid)

      admissionBarrier.release()
      await admission
      await expect(update).resolves.toHaveProperty("rowCount", 1)
      await updater.query("COMMIT")
    } finally {
      admissionBarrier.release()
      await Promise.allSettled([updater.query("ROLLBACK")])
      await Promise.all([updater.end(), inspector.end()])
    }
  })

  it("makes provider revision mutation wait for the session-restore provider lock", async () => {
    const { providerId } = await createProvider()
    const updater = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([updater.connect(), inspector.connect()])
    const restoreBarrier = barrier()
    let providerLocked!: () => void
    const providerReady = new Promise<void>((resolve) => {
      providerLocked = resolve
    })
    try {
      const restoration = runSessionRestoreTransaction(prisma, async (repositories) => {
        await expect(repositories.lockProvider("github")).resolves.not.toBeNull()
        providerLocked()
        await restoreBarrier.wait
      })
      await providerReady

      const updaterPid = await updater.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`)
      await updater.query("BEGIN")
      const update = updater.query(
        `UPDATE authentication_providers
         SET updated_at = clock_timestamp()
         WHERE id = $1`,
        [providerId],
      )
      await observeBlocked(inspector, updaterPid.rows[0]!.pid)

      restoreBarrier.release()
      await restoration
      await expect(update).resolves.toHaveProperty("rowCount", 1)
      await updater.query("COMMIT")
    } finally {
      restoreBarrier.release()
      await Promise.allSettled([updater.query("ROLLBACK")])
      await Promise.all([updater.end(), inspector.end()])
    }
  })
})
