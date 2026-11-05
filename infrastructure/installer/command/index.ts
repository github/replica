import { spawn } from "node:child_process"

import type { RunCommand } from "../types.ts"

export class CommandExecutionError extends Error {
  readonly aborted: boolean

  constructor(message: string, aborted = false) {
    super(message)
    this.name = "CommandExecutionError"
    this.aborted = aborted
  }
}

export const runCommand: RunCommand = (executable, args, options = {}) =>
  new Promise((resolve, reject) => {
    options.signal?.throwIfAborted()
    const operation = options.label ?? executable
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })
    const chunks: Buffer[] = []
    let bytes = 0
    let exceeded = false
    let terminationTimeout: ReturnType<typeof setTimeout> | undefined
    function signalChild(signal: NodeJS.Signals) {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
      }
    }
    const terminate = () => {
      if (terminationTimeout) return
      signalChild("SIGTERM")
      terminationTimeout = setTimeout(() => signalChild("SIGKILL"), 5_000)
      terminationTimeout.unref()
    }
    options.signal?.addEventListener("abort", terminate, { once: true })
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 32 * 1024 * 1024) {
        exceeded = true
        terminate()
      } else {
        chunks.push(chunk)
      }
    })
    // Azure and migration diagnostics may contain credentials. Never forward them to the TUI.
    child.stderr.resume()
    child.on("error", () =>
      reject(
        new CommandExecutionError(
          `${operation} could not start. Check ${executable} installation and permissions.`,
        ),
      ),
    )
    child.on("close", (code) => {
      clearTimeout(terminationTimeout)
      options.signal?.removeEventListener("abort", terminate)
      if (code !== 0 || exceeded || options.signal?.aborted) {
        const reason = options.signal?.aborted
          ? "cancelled"
          : exceeded
            ? "output limit exceeded"
            : code === null
              ? "process terminated"
              : `exit code ${code}`
        reject(
          new CommandExecutionError(
            `${operation} failed (${reason}). Inspect this step with authorized tooling; command output is withheld because it may contain credentials.`,
            options.signal?.aborted,
          ),
        )
      } else {
        resolve(Buffer.concat(chunks).toString("utf8").trim())
      }
    })
  })
