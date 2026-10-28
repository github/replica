import pino from "pino"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { runJobWorker } from "."

const { createJobWorker } = vi.hoisted(() => ({ createJobWorker: vi.fn() }))
vi.mock("../../integrations/bullmq/create-job-worker/index.ts", () => ({
  createJobWorker,
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve: () => resolve() }
}

describe("runJobWorker()", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "drains the worker and removes both signal listeners after %s",
    async (signal) => {
      const run = deferred()
      const close = deferred()
      const worker = {
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockReturnValue(run.promise),
        close: vi.fn().mockReturnValue(close.promise),
      }
      createJobWorker.mockReturnValue(worker)
      const once = vi.spyOn(process, "once").mockReturnValue(process)
      const removeListener = vi.spyOn(process, "removeListener")
      const completed = vi.fn()
      const task = runJobWorker({
        name: "on-demand",
        databaseUrl: "postgresql://127.0.0.1:1/not-used",
        logger: pino({ level: "silent" }),
        processors: [],
        concurrency: 2,
      }).then(completed)
      const stop = once.mock.calls.find(([event]) => event === signal)?.[1]
      onTestFinished(async () => {
        stop?.()
        close.resolve()
        run.resolve()
        await task
      })
      if (!stop) throw new Error("The worker must register its shutdown handler.")
      await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce())

      stop()
      await vi.waitFor(() => expect(worker.close).toHaveBeenCalledOnce())
      expect(completed).not.toHaveBeenCalled()
      close.resolve()
      await Promise.resolve()
      expect(completed).not.toHaveBeenCalled()
      run.resolve()
      await task

      expect(removeListener).toHaveBeenCalledWith("SIGINT", stop)
      expect(removeListener).toHaveBeenCalledWith("SIGTERM", stop)
    },
  )

  it("closes the worker and propagates startup failures without starting the run loop", async () => {
    const failure = new Error("Startup failed")
    const worker = {
      waitUntilReady: vi.fn().mockRejectedValue(failure),
      run: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    createJobWorker.mockReturnValue(worker)
    const once = vi.spyOn(process, "once").mockReturnValue(process)
    const removeListener = vi.spyOn(process, "removeListener")

    await expect(
      runJobWorker({
        name: "scheduled",
        databaseUrl: "postgresql://127.0.0.1:1/not-used",
        logger: pino({ level: "silent" }),
        processors: [],
      }),
    ).rejects.toBe(failure)

    expect(worker.run).not.toHaveBeenCalled()
    expect(worker.close).toHaveBeenCalledOnce()
    const stop = once.mock.calls.find(([event]) => event === "SIGINT")?.[1]
    expect(removeListener).toHaveBeenCalledWith("SIGINT", stop)
    expect(removeListener).toHaveBeenCalledWith("SIGTERM", stop)
  })

  it("stops during pending readiness without starting the worker or reporting it ready", async () => {
    const ready = deferred()
    const worker = {
      waitUntilReady: vi.fn().mockReturnValue(ready.promise),
      run: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    createJobWorker.mockReturnValue(worker)
    const once = vi.spyOn(process, "once").mockReturnValue(process)
    const lines: string[] = []
    const logger = pino({ level: "info" }, { write: (line) => lines.push(line) })
    const task = runJobWorker({
      name: "scheduled",
      databaseUrl: "postgresql://127.0.0.1:1/not-used",
      logger,
      processors: [],
    })
    const stop = once.mock.calls.find(([event]) => event === "SIGTERM")?.[1]
    onTestFinished(async () => {
      stop?.()
      ready.resolve()
      await task
    })
    if (!stop) throw new Error("The worker must register its shutdown handler.")

    stop()
    await vi.waitFor(() => expect(worker.close).toHaveBeenCalledOnce())
    await task
    ready.resolve()
    await ready.promise

    expect(worker.run).not.toHaveBeenCalled()
    expect(lines.join("")).not.toContain("Job worker ready")
  })

  it("closes the worker and propagates failures from the run loop", async () => {
    const failure = new Error("Worker run failed")
    const worker = {
      waitUntilReady: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockRejectedValue(failure),
      close: vi.fn().mockResolvedValue(undefined),
    }
    createJobWorker.mockReturnValue(worker)
    vi.spyOn(process, "once").mockReturnValue(process)

    await expect(
      runJobWorker({
        name: "on-demand",
        databaseUrl: "postgresql://127.0.0.1:1/not-used",
        logger: pino({ level: "silent" }),
        processors: [],
      }),
    ).rejects.toBe(failure)
    expect(worker.close).toHaveBeenCalledOnce()
  })

  it.each(["close", "run"] as const)(
    "rejects shutdowns when %s exceeds the configured deadline",
    async (pendingPhase) => {
      vi.useFakeTimers()
      const run = deferred()
      const close = deferred()
      const worker = {
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockReturnValue(run.promise),
        close: vi
          .fn()
          .mockReturnValue(pendingPhase === "close" ? close.promise : Promise.resolve()),
      }
      createJobWorker.mockReturnValue(worker)
      const once = vi.spyOn(process, "once").mockReturnValue(process)
      const task = runJobWorker({
        name: "scheduled",
        databaseUrl: "postgresql://127.0.0.1:1/not-used",
        logger: pino({ level: "silent" }),
        processors: [],
        shutdownTimeoutMs: 25,
      })
      onTestFinished(async () => {
        close.resolve()
        run.resolve()
        await task.catch(() => {})
      })
      await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce())
      const stop = once.mock.calls.find(([event]) => event === "SIGTERM")?.[1]
      if (!stop) throw new Error("The worker must register its shutdown handler.")

      const rejected = expect(task).rejects.toThrow(/deadline/i)
      stop()
      await vi.advanceTimersByTimeAsync(25)
      await rejected
      expect(worker.close).toHaveBeenCalledOnce()
    },
  )
})
