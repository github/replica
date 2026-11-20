import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { describe, expect, it } from "vitest"

import { CommandExecutionError, runCommand } from "../index.ts"

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    throw error
  }
}

async function ready(path: string): Promise<{ parent: number; child: number; grandchild: number }> {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8"))
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error
      await delay(25)
    }
  }
  throw new Error("The owned command tree did not signal readiness")
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = performance.now() + 5_000
  while (alive(pid) && performance.now() < deadline) await delay(25)
  expect(alive(pid)).toBe(false)
}

describe.skipIf(process.platform !== "win32")("native Windows installer command cancellation", () => {
  it.each(["running", "exited"] as const)(
    "stops and waits for the owned descendant with a %s parent",
    async (parentState) => {
      const root = resolve(`.installer-cancel-test-${randomUUID()}`)
      await mkdir(root)
      const readyPath = join(root, "ready.json")
      const ownerPath = join(root, "owner.json")
      const exitPath = join(root, "exit-parent")
      const controller = new AbortController()
      const grandchildScript = `
        const { writeFileSync } = require("node:fs");
        writeFileSync(process.env.REPLICA_CANCEL_READY, JSON.stringify({
          parent: Number(process.env.REPLICA_CANCEL_PARENT),
          child: Number(process.env.REPLICA_CANCEL_CHILD), grandchild: process.pid
        }));
        setInterval(() => {}, 1000);
      `
      const childScript = `
        const { spawn } = require("node:child_process");
        spawn(process.execPath, ["-e", ${JSON.stringify(grandchildScript)}], {
          stdio: ["ignore", "inherit", "inherit"], detached: true, windowsHide: true,
          env: { ...process.env, REPLICA_CANCEL_PARENT: String(process.ppid),
            REPLICA_CANCEL_CHILD: String(process.pid) }
        });
        setInterval(() => {}, 1000);
      `
      const parentScript = `
        const { spawn } = require("node:child_process");
        const { existsSync, writeFileSync } = require("node:fs");
        writeFileSync(process.env.REPLICA_CANCEL_OWNER, JSON.stringify({ parent: process.pid }));
        spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], {
          stdio: ["ignore", "inherit", "inherit"], detached: true, windowsHide: true
        });
        setInterval(() => {
          if (existsSync(process.env.REPLICA_CANCEL_EXIT)) process.exit(0);
        }, 25);
      `
      const result = runCommand(process.execPath, ["-e", parentScript], {
        signal: controller.signal,
        env: {
          REPLICA_CANCEL_READY: readyPath,
          REPLICA_CANCEL_OWNER: ownerPath,
          REPLICA_CANCEL_EXIT: exitPath,
        },
      }).then(
        () => ({ error: undefined }),
        (error: unknown) => ({ error }),
      )
      let pids: Awaited<ReturnType<typeof ready>> | undefined
      try {
        pids = await ready(readyPath)
        expect(alive(pids.parent)).toBe(true)
        expect(alive(pids.child)).toBe(true)
        expect(alive(pids.grandchild)).toBe(true)
        if (parentState === "exited") {
          await writeFile(exitPath, "")
          await waitForExit(pids.parent)
        }

        controller.abort()
        const outcome = await Promise.race([
          result,
          delay(10_000, undefined, { ref: false }).then(() => {
            throw new Error("Cancellation did not finish")
          }),
        ])

        if (parentState === "running" || outcome.error !== undefined) {
          expect(outcome.error).toBeInstanceOf(CommandExecutionError)
          expect((outcome.error as CommandExecutionError).aborted).toBe(true)
        }
        expect(alive(pids.parent)).toBe(false)
        expect(alive(pids.child)).toBe(false)
        expect(alive(pids.grandchild)).toBe(false)
      } finally {
        controller.abort()
        pids ??= await readFile(readyPath, "utf8")
          .then((value) => JSON.parse(value))
          .catch(() => undefined)
        const owner = await readFile(ownerPath, "utf8")
          .then((value) => JSON.parse(value) as { parent: number })
          .catch(() => undefined)
        const owned = pids ? [pids.grandchild, pids.child, pids.parent] : owner ? [owner.parent] : []
        for (const pid of owned) {
          if (alive(pid)) process.kill(pid, "SIGKILL")
          await waitForExit(pid)
        }
        await result
        await rm(root, { recursive: true, force: true })
      }
    },
    30_000,
  )
})
