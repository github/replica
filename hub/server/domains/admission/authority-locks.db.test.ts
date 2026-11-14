import { createHash, randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { getDatabaseUrl } from "../../../test/database/get-database-url"
import { runAdmissionTransaction } from "./run-admission-transaction"
import { restoreHubSession } from "./restore-hub-session"
import { runSessionRestoreTransaction } from "./run-session-restore-transaction"

async function observeBlocked(inspector: pg.Client, pid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await inspector.query<{ blocked: boolean }>(
      `SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked`,
      [pid],
    )
    if (result.rows[0]?.blocked) return true
    await Promise.resolve()
  }
  return false
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
      async function waitsForProvider() {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const result = await inspector.query<{ blocked: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity waiter
               WHERE waiter.datname = current_database()
                 AND waiter.wait_event_type = 'Lock'
                 AND waiter.query LIKE '%authentication_providers%'
                 AND $1 = ANY(pg_blocking_pids(waiter.pid))
             ) AS blocked`,
            [providerPid],
          )
          if (result.rows[0]?.blocked) return true
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        return false
      }
      expect(await waitsForProvider()).toBe(true)

      await providerHolder.query("COMMIT")
      providerTransactionOpen = false
      let waitsForRevocation = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await inspector.query<{ blocked: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity waiter
             WHERE waiter.datname = current_database()
               AND waiter.wait_event_type = 'Lock'
               AND waiter.query LIKE '%session_revocation_states%'
               AND $1 = ANY(pg_blocking_pids(waiter.pid))
           ) AS blocked`,
          [revocationPid],
        )
        if (result.rows[0]?.blocked) {
          waitsForRevocation = true
          break
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      expect(waitsForRevocation).toBe(true)
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
      expect(await observeBlocked(inspector, updaterPid.rows[0]!.pid)).toBe(true)

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
      expect(await observeBlocked(inspector, updaterPid.rows[0]!.pid)).toBe(true)

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
      expect(await observeBlocked(inspector, updaterPid.rows[0]!.pid)).toBe(true)

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
