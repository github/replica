import { EventEmitter } from "node:events"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { deferred } from "../../test/ws/deferred"
import { createLogger } from "../integrations/pino/create-logger"
import { openDatabase } from "../integrations/postgres/open-database"
import { runApi } from "../run-api"
import { runJobWorker } from "../workers/run-job-worker"

import { runCombined } from "."

vi.mock("../integrations/postgres/open-database", () => ({ openDatabase: vi.fn() }))
vi.mock("../run-api", () => ({ runApi: vi.fn() }))
vi.mock("../workers/run-job-worker", () => ({ runJobWorker: vi.fn() }))

function arrangeRuntime() {
  const query = vi.fn().mockResolvedValue({
    command: "SELECT",
    rowCount: 1,
    oid: 0,
    fields: [],
    rows: [{ "?column?": 1 }],
  })
  const end = vi.fn().mockResolvedValue(undefined)
  const database = Object.assign(new EventEmitter(), { query, end })
  vi.mocked(openDatabase).mockReturnValue(database as unknown as ReturnType<typeof openDatabase>)
  vi.mocked(runApi).mockImplementation(
    ({ signal }) =>
      new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true })
      }),
  )
  vi.mocked(runJobWorker).mockImplementation(
    ({ signal }) =>
      new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true })
      }),
  )
  const existing = process.listeners("SIGTERM")
  const running = runCombined({
    port: 3001,
    host: "127.0.0.1",
    databaseUrl: "postgresql://test:test@localhost/runtime_test",
    shutdownTimeoutMs: 100,
    logger: createLogger({ level: "silent" }),
    onDemandConcurrency: 2,
    scheduledConcurrency: 1,
  })
  void running.catch(() => {})
  function stop() {
    const handler = process.listeners("SIGTERM").find((listener) => !existing.includes(listener))
    if (handler) Reflect.apply(handler, process, ["SIGTERM"])
  }
  onTestFinished(async () => {
    stop()
    await running.catch(() => {})
  })
  return { database, query, end, running, stop }
}

describe("runCombined()", () => {
  it("reports readiness only after both workers and the database are ready", async () => {
    const { query, end, running, stop } = arrangeRuntime()
    await vi.waitFor(() => expect(runApi).toHaveBeenCalledTimes(1))
    const api = vi.mocked(runApi).mock.calls[0]![0]
    const workers = vi.mocked(runJobWorker).mock.calls.map(([options]) => options)
    expect(workers.map(({ name }) => name).sort()).toEqual(["on-demand", "scheduled"])
    expect(await api.isReady?.()).toBe(false)
    workers[0]!.onReady?.()
    expect(await api.isReady?.()).toBe(false)
    workers[1]!.onReady?.()
    expect(await api.isReady?.()).toBe(true)
    query.mockRejectedValueOnce(new Error("Database unavailable"))
    expect(await api.isReady?.().catch(() => false)).toBe(false)

    stop()
    await running

    expect(api.signal?.aborted).toBe(true)
    expect(workers.every(({ signal }) => signal?.aborted)).toBe(true)
    expect(await api.isReady?.()).toBe(false)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it.each(["api", "on-demand", "scheduled"] as const)(
    "fails and aborts its peers when the required %s component exits",
    async (role) => {
      const exited = deferred<void>()
      const { running, end } = arrangeRuntime()
      if (role === "api") {
        vi.mocked(runApi).mockImplementationOnce(() => exited.promise)
      } else {
        const defaultWorker = vi.mocked(runJobWorker).getMockImplementation()!
        vi.mocked(runJobWorker).mockImplementation((options) =>
          options.name === role ? exited.promise : defaultWorker(options),
        )
      }
      await vi.waitFor(() => expect(runApi).toHaveBeenCalledTimes(1))
      const api = vi.mocked(runApi).mock.calls[0]![0]
      const workers = vi.mocked(runJobWorker).mock.calls.map(([options]) => options)

      exited.resolve()

      await expect(running).rejects.toThrow(/required|component|stopped|failed/i)
      expect(api.signal?.aborted).toBe(true)
      expect(workers.every(({ signal }) => signal?.aborted)).toBe(true)
      expect(end).toHaveBeenCalledTimes(1)
    },
  )
})
