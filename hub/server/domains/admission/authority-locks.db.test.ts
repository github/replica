import { randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { getDatabaseUrl } from "../../../test/database/get-database-url"
import { runAdmissionTransaction } from "./run-admission-transaction"

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
          selectedRevisionId: revisionId,
        })
        await expect(repositories.lockRevocation()).resolves.toMatchObject({ revision: 0 })
        firstLocked()
        await firstBarrier.wait
      })
      await firstReady
      const secondAdmission = runAdmissionTransaction(prisma, async (repositories) => {
        await expect(repositories.lockProvider("github")).resolves.toEqual({
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
})
