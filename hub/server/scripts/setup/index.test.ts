import { spawn, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"

import { setup } from "."

vi.mock("dotenv/config", () => ({}))
vi.mock("node:child_process", () => ({ spawn: vi.fn() }))
vi.mock("../../integrations/pino", () => ({ logger: { info: vi.fn() } }))
vi.mock("../../integrations/postgres/with-setup-lock", () => ({
  withSetupLock: async ({
    run,
    signal,
  }: {
    run: (signal: AbortSignal) => Promise<void>
    signal: AbortSignal
  }) => run(signal),
}))

describe("setup()", () => {
  it("passes native job and runtime-grant script paths to Node", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://replica_migration@localhost/replica")
    vi.stubEnv("DATABASE_RUNTIME_ROLE", "replica_runtime")
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter() as ChildProcess
      child.kill = vi.fn(() => true)
      queueMicrotask(() => child.emit("close", 0))
      return child
    })

    await setup()

    expect(spawn).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [fileURLToPath(new URL("../setup-jobs/index.ts", import.meta.url))],
      { stdio: "ignore" },
    )
    expect(spawn).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [fileURLToPath(new URL("../grant-runtime-database-access/index.ts", import.meta.url))],
      { stdio: "ignore" },
    )
  })
})
