import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { setTimeout } from "node:timers/promises"
import { inspect } from "node:util"
import { expect, it, vi } from "vitest"
import { CommandExecutionError, runCommand } from "./index.ts"

it("refuses an already cancelled command without starting it", async () => {
  const abort = new AbortController()
  abort.abort()
  await expect(
    runCommand(process.execPath, ["-e", "process.exit(0)"], {
      signal: abort.signal,
    }),
  ).rejects.toThrow()
})

it("terminates running work when the operator cancels", async () => {
  const abort = new AbortController()
  const pending = runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    signal: abort.signal,
  })
  abort.abort()
  await expect(pending).rejects.toThrow("failed")
})

it("awaits forced cleanup of an owned SIGTERM-ignoring descendant after its parent exits", async () => {
  const directory = resolve(`.installer-command-cancel-test-${randomUUID()}`)
  await mkdir(directory, { mode: 0o700 })
  const filename = join(directory, "owned-processes.json")
  const abort = new AbortController()
  const cleanupBound = new AbortController()
  let owned: { parent: number; child: number } | undefined
  const child = `
    const fs = require("node:fs");
    process.on("SIGTERM", () => {});
    fs.writeFileSync(${JSON.stringify(filename)}, JSON.stringify({
      parent: process.ppid, child: process.pid
    }), { mode: 0o600 });
    setInterval(() => {}, 1000);
  `
  const pending = runCommand(
    process.execPath,
    [
      "-e",
      `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(child)}], {
        stdio: "ignore"
      });
      setInterval(() => {}, 1000);`,
    ],
    { signal: abort.signal, label: "Synthetic cancellable work" },
  ).catch((error: unknown) => error)
  try {
    const deadline = Date.now() + 5000
    while (!owned && Date.now() < deadline) {
      try {
        owned = JSON.parse(await readFile(filename, "utf8")) as typeof owned
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        await setTimeout(10)
      }
    }
    expect(owned).toBeDefined()
    expect(owned!.parent).toBeGreaterThan(0)
    expect(owned!.child).toBeGreaterThan(0)
    expect(owned!.parent).not.toBe(process.pid)
    expect(owned!.child).not.toBe(process.pid)

    abort.abort()
    const failure = await Promise.race([
      pending,
      setTimeout(
        10_000,
        new Error("Cancellation did not complete within its cleanup bound"),
        { signal: cleanupBound.signal },
      ).catch((error: unknown) => error),
    ])

    expect(failure).toMatchObject({ aborted: true })
    expect(() => process.kill(owned!.parent, 0)).toThrow()
    expect(() => process.kill(owned!.child, 0)).toThrow()
  } finally {
    cleanupBound.abort()
    abort.abort()
    if (!owned) {
      owned = await readFile(filename, "utf8").then(
        (value) => JSON.parse(value) as typeof owned,
        () => undefined,
      )
    }
    if (owned) {
      for (const pid of [-owned.parent, owned.parent, owned.child]) {
        try {
          process.kill(pid, "SIGKILL")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        }
      }
    }
    await pending
    await rm(directory, { recursive: true, force: true })
  }
})

it("keeps cleanup permission errors private while preserving cancellation and cleaning up the owned child", async () => {
  const directory = resolve(`.installer-command-permission-test-${randomUUID()}`)
  await mkdir(directory, { mode: 0o700 })
  const filename = join(directory, "owned-process.json")
  const abort = new AbortController()
  const realKill = process.kill.bind(process)
  const secret = "synthetic-cleanup-os-error-secret"
  const denied = Object.assign(new Error(secret), { code: "EPERM" })
  let owned: number | undefined
  const pending = runCommand(
    process.execPath,
    [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(filename)},
        JSON.stringify({ pid: process.pid }), { mode: 0o600 });
       setTimeout(() => process.exit(0), 5000);`,
    ],
    { signal: abort.signal, label: "Synthetic cancellation cleanup" },
  ).catch((error: unknown) => error)
  try {
    const deadline = Date.now() + 5000
    while (owned === undefined && Date.now() < deadline) {
      try {
        owned = (JSON.parse(await readFile(filename, "utf8")) as { pid: number }).pid
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        await setTimeout(10)
      }
    }
    expect(owned).toBeGreaterThan(0)
    expect(owned).not.toBe(process.pid)
    if (owned === undefined) throw new Error("Expected the owned child's PID")
    const childPid = owned
    let signallingFailed = false
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === childPid || pid === -childPid) {
        signallingFailed = true
        throw denied
      }
      return realKill(pid, signal)
    })
    let failure: unknown
    try {
      abort.abort()
      failure = await pending
    } finally {
      kill.mockRestore()
    }

    expect(signallingFailed).toBe(true)
    expect(failure).toBeInstanceOf(CommandExecutionError)
    expect(failure).toMatchObject({ aborted: true })
    expect((failure as Error).message).toContain("failed")
    expect(inspect(failure, { depth: 10, showHidden: true })).not.toContain(secret)
    expect(JSON.stringify(failure)).not.toContain(secret)
  } finally {
    abort.abort()
    if (owned === undefined)
      owned = await readFile(filename, "utf8").then(
        (value) => (JSON.parse(value) as { pid: number }).pid,
        () => undefined,
      )
    if (owned !== undefined)
      for (const pid of [-owned, owned]) {
        try {
          realKill(pid, "SIGKILL")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        }
      }
    await pending
    await rm(directory, { recursive: true, force: true })
  }
})
