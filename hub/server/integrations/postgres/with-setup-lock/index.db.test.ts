import { once } from "node:events"
import { Client } from "pg"
import { describe, expect, it, vi } from "vitest"

import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { deferred } from "../../../../test/ws/deferred"

import { withSetupLock } from "."

describe("withSetupLock()", () => {
  it("holds the lock across all setup steps and rejects a competing setup before its steps run", async () => {
    const databaseUrl = getDatabaseUrl()
    const entered = deferred<void>()
    const finish = deferred<void>()
    const steps: string[] = []
    const first = withSetupLock({
      databaseUrl,
      run: async (signal) => {
        expect(signal.aborted).toBe(false)
        steps.push("migrations")
        entered.resolve()
        await finish.promise
        steps.push("job schema")
      },
    })
    void first.catch(() => {})

    try {
      await Promise.race([entered.promise, first])
      const competingSteps = vi.fn(async () => {})
      await expect(withSetupLock({ databaseUrl, run: competingSteps })).rejects.toThrow(
        /setup.*(running|progress|lock)|lock.*setup/i,
      )
      expect(competingSteps).not.toHaveBeenCalled()
      expect(steps).toEqual(["migrations"])
    } finally {
      finish.resolve()
      await first
    }

    expect(steps).toEqual(["migrations", "job schema"])
    const subsequentSteps = vi.fn(async () => {})
    await withSetupLock({ databaseUrl, run: subsequentSteps })
    expect(subsequentSteps).toHaveBeenCalledTimes(1)
  })

  it("releases the lock after a setup step fails so a later setup can run", async () => {
    const databaseUrl = getDatabaseUrl()
    const failure = new Error("Setup step failed")
    await expect(
      withSetupLock({
        databaseUrl,
        run: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure)

    const retry = vi.fn(async () => {})
    await withSetupLock({ databaseUrl, run: retry })
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it("aborts setup on lock connection loss and waits for cleanup before rejecting safely", async () => {
    const databaseUrl = getDatabaseUrl()
    const connection = new Client({ connectionString: databaseUrl })
    await connection.connect()
    const entered = deferred<AbortSignal>()
    const cleanup = deferred<void>()
    const controller = new AbortController()
    let cleanupStarted = false
    let cleanedUp = false
    let settled = false
    const running = withSetupLock({
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
          throw new Error("Setup returned before its steps started")
        }),
      ])
      const result = await connection.query<{ terminated: boolean }>(
        `SELECT pg_terminate_backend(pid) AS terminated
         FROM pg_locks
         WHERE locktype = 'advisory' AND classid = 1919242348 AND objid = 1
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
      await expect(running).rejects.toThrow(/setup.*lost.*lock.*connection/i)
      await expect(running).rejects.not.toThrow(databaseUrl)
      expect(cleanedUp).toBe(true)
      const retry = vi.fn(async () => {})
      await withSetupLock({ databaseUrl, run: retry })
      expect(retry).toHaveBeenCalledTimes(1)
    } finally {
      controller.abort()
      cleanup.resolve()
      await running.catch(() => {})
      await connection.end()
    }
  })
})
