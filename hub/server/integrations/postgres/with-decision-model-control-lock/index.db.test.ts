import { once } from "node:events"
import { Client } from "pg"
import { describe, expect, it, vi } from "vitest"

import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { deferred } from "../../../../test/ws/deferred"

import { withDecisionModelControlLock } from "."

describe("withDecisionModelControlLock()", () => {
  it("does not enter a competing promotion or rejection while the lock is held", async () => {
    const databaseUrl = getDatabaseUrl()
    const entered = deferred<void>()
    const finish = deferred<void>()
    const first = withDecisionModelControlLock({
      databaseUrl,
      run: async () => {
        entered.resolve()
        await finish.promise
      },
    })
    void first.catch(() => {})

    try {
      await Promise.race([entered.promise, first])
      const competingOperation = vi.fn(async () => {})

      await expect(
        withDecisionModelControlLock({
          databaseUrl,
          run: competingOperation,
        }),
      ).rejects.toThrow(/another decision-model control operation.*running/i)
      expect(competingOperation).not.toHaveBeenCalled()
    } finally {
      finish.resolve()
      await first
    }
  })

  it("aborts the control operation when its lock connection is lost", async () => {
    const databaseUrl = getDatabaseUrl()
    const connection = new Client({ connectionString: databaseUrl })
    await connection.connect()
    const entered = deferred<AbortSignal>()
    const cleanup = deferred<void>()
    const running = withDecisionModelControlLock({
      databaseUrl,
      run: async (signal) => {
        entered.resolve(signal)
        await once(signal, "abort")
        await cleanup.promise
      },
    })

    try {
      const signal = await entered.promise
      const result = await connection.query<{ terminated: boolean }>(
        `SELECT pg_terminate_backend(pid) AS terminated
         FROM pg_locks
         WHERE locktype = 'advisory' AND classid = 1919242348 AND objid = 3
           AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND granted AND pid <> pg_backend_pid()`,
      )
      expect(result.rows).toEqual([{ terminated: true }])
      await vi.waitFor(() => expect(signal.aborted).toBe(true))
      cleanup.resolve()
      await expect(running).rejects.toThrow(/control lock connection/i)
      await expect(running).rejects.not.toThrow(databaseUrl)
    } finally {
      cleanup.resolve()
      await running.catch(() => {})
      await connection.end()
    }
  })
})
