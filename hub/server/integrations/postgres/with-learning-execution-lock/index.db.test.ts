import { once } from "node:events"
import { Client } from "pg"
import { describe, expect, it, vi } from "vitest"

import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { deferred } from "../../../../test/ws/deferred"

import { withLearningExecutionLock } from "."

describe("withLearningExecutionLock()", () => {
  it("does not enter a competing learning operation while the lock is held", async () => {
    const databaseUrl = getDatabaseUrl()
    const entered = deferred<void>()
    const finish = deferred<void>()
    const first = withLearningExecutionLock({
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
        withLearningExecutionLock({ databaseUrl, run: competingOperation }),
      ).rejects.toThrow(/another learning operation.*running/i)
      expect(competingOperation).not.toHaveBeenCalled()
    } finally {
      finish.resolve()
      await first
    }
  })

  it("releases the lock after a learning operation fails", async () => {
    const databaseUrl = getDatabaseUrl()
    const failure = new Error("Learning operation failed")

    await expect(
      withLearningExecutionLock({
        databaseUrl,
        run: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure)

    const retry = vi.fn(async () => {})
    await withLearningExecutionLock({ databaseUrl, run: retry })
    expect(retry).toHaveBeenCalledOnce()
  })

  it("aborts the learning operation on lock connection loss before rejecting", async () => {
    const databaseUrl = getDatabaseUrl()
    const connection = new Client({ connectionString: databaseUrl })
    await connection.connect()
    const entered = deferred<AbortSignal>()
    const cleanup = deferred<void>()
    const controller = new AbortController()
    let cleanupStarted = false
    let cleanedUp = false
    let settled = false
    const running = withLearningExecutionLock({
      databaseUrl,
      signal: controller.signal,
      run: async (signal) => {
        entered.resolve(signal)
        await once(signal, "abort")
        cleanupStarted = true
        await cleanup.promise
        cleanedUp = true
      },
    })
    void running.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    try {
      const signal = await Promise.race([
        entered.promise,
        running.then(() => {
          throw new Error("Learning operation returned before it started")
        }),
      ])
      const result = await connection.query<{ terminated: boolean }>(
        `SELECT pg_terminate_backend(pid) AS terminated
         FROM pg_locks
         WHERE locktype = 'advisory' AND classid = 1919242348 AND objid = 2
           AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND granted AND pid <> pg_backend_pid()`,
      )
      expect(result.rows).toEqual([{ terminated: true }])
      await vi.waitFor(() => {
        expect(signal.aborted).toBe(true)
        expect(cleanupStarted).toBe(true)
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      expect(cleanedUp).toBe(false)

      cleanup.resolve()
      await expect(running).rejects.toThrow(/learning execution lock connection/i)
      await expect(running).rejects.not.toThrow(databaseUrl)
      expect(cleanedUp).toBe(true)
    } finally {
      controller.abort()
      cleanup.resolve()
      await running.catch(() => {})
      await connection.end()
    }
  })
})
