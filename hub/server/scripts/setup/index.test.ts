import { spawn, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"

import { setup } from "."

const lock = vi.hoisted(() => ({ active: false }))

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
  }) => {
    lock.active = true
    try {
      await run(signal)
    } finally {
      lock.active = false
    }
  },
}))

describe("setup()", () => {
  it("passes native job and runtime-grant script paths to Node", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://replica_migration@localhost/replica")
    vi.stubEnv("DATABASE_RUNTIME_ROLE", "replica_runtime")
    vi.stubEnv("REPLICA_LEARNING_MIGRATION_DATABASE_URL", undefined)
    vi.stubEnv("REPLICA_LEARNING_RUNTIME_ROLE", undefined)
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter() as ChildProcess
      child.kill = vi.fn(() => true)
      queueMicrotask(() => child.emit("close", 0))
      return child
    })

    await setup()

    expect(spawn).toHaveBeenCalledTimes(3)
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

  it("migrates and grants the learning database under the setup lock", async () => {
    const migrationUrl = "postgresql://learning_migration@localhost/replica"
    vi.stubEnv("DATABASE_URL", "postgresql://replica_migration@localhost/replica")
    vi.stubEnv("DATABASE_RUNTIME_ROLE", undefined)
    vi.stubEnv("REPLICA_LEARNING_MIGRATION_DATABASE_URL", migrationUrl)
    vi.stubEnv("REPLICA_LEARNING_RUNTIME_ROLE", "replica_learning_runtime")
    vi.stubEnv("REPLICA_LEARNING_CLI", "learning-cli.mjs")
    vi.mocked(spawn).mockImplementation((_command, arguments_) => {
      expect(lock.active).toBe(true)
      expect(arguments_).not.toContain(migrationUrl)
      const child = new EventEmitter() as ChildProcess
      child.kill = vi.fn(() => true)
      queueMicrotask(() => child.emit("close", 0))
      return child
    })

    await setup()

    expect(spawn).toHaveBeenCalledTimes(4)
    expect(spawn).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [resolve("learning-cli.mjs"), "migrate"],
      { stdio: "ignore" },
    )
    expect(spawn).toHaveBeenNthCalledWith(
      4,
      process.execPath,
      [fileURLToPath(new URL("../grant-learning-database-access/index.ts", import.meta.url))],
      { stdio: "ignore" },
    )
  })
})
