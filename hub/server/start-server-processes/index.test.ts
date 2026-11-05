import { EventEmitter } from "node:events"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { deferred } from "../../test/ws/deferred"
import { createLogger } from "../integrations/pino/create-logger"
import { openDatabase } from "../integrations/postgres/open-database"
import { runApi } from "../run-api"
import type { AuthenticationRouteDependencies } from "../routes/api/auth/types"
import { runJobWorker } from "../workers/run-job-worker"

import { startServerProcesses } from "."

vi.mock("../integrations/postgres/open-database", () => ({ openDatabase: vi.fn() }))
vi.mock("../run-api", () => ({ runApi: vi.fn() }))
vi.mock("../workers/run-job-worker", () => ({ runJobWorker: vi.fn() }))

function arrangeRuntime(
  isStorageReady?: () => Promise<boolean>,
  runtimeOptions: {
    authentication?: AuthenticationRouteDependencies
    trustedProxyHops?: number
  } = {},
) {
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
  const running = startServerProcesses({
    port: 3001,
    host: "127.0.0.1",
    databaseUrl: "postgresql://test:test@localhost/runtime_test",
    shutdownTimeoutMs: 100,
    logger: createLogger({ level: "silent" }),
    onDemandConcurrency: 2,
    scheduledConcurrency: 1,
    isStorageReady,
    ...runtimeOptions,
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

describe("startServerProcesses()", () => {
  it("passes authentication and trusted proxy settings to the combined API", async () => {
    const authentication = {} as AuthenticationRouteDependencies
    arrangeRuntime(undefined, { authentication, trustedProxyHops: 2 })

    await vi.waitFor(() => expect(runApi).toHaveBeenCalledTimes(1))
    expect(vi.mocked(runApi)).toHaveBeenCalledWith(
      expect.objectContaining({ authentication, trustedProxyHops: 2 }),
    )
  })

  it("requires configured storage as well as initialized workers and a live database", async () => {
    const isStorageReady = vi.fn().mockResolvedValue(false)
    const { query } = arrangeRuntime(isStorageReady)
    await vi.waitFor(() => expect(runApi).toHaveBeenCalledTimes(1))
    const api = vi.mocked(runApi).mock.calls[0]![0]
    const workers = vi.mocked(runJobWorker).mock.calls.map(([options]) => options)
    expect(await api.isReady?.()).toBe(false)
    expect(isStorageReady).not.toHaveBeenCalled()
    workers.forEach((worker) => worker.onReady?.())

    expect(await api.isReady?.()).toBe(false)
    isStorageReady.mockResolvedValue(true)
    expect(await api.isReady?.()).toBe(true)
    query.mockRejectedValueOnce(new Error("Database unavailable"))
    await expect(api.isReady?.()).rejects.toThrow("Database unavailable")
    expect(isStorageReady).toHaveBeenCalledTimes(2)
  })

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
