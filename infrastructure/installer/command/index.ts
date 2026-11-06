import { spawn } from "node:child_process"
import { stripVTControlCharacters } from "node:util"

import type { RunCommand } from "../types.ts"
import { describeCommand } from "./describe/index.ts"

export class CommandExecutionError extends Error {
  readonly aborted: boolean
  readonly exitCode: number | undefined
  #details: string | undefined

  constructor(message: string, aborted = false, exitCode?: number, details?: string) {
    super(message)
    this.name = "CommandExecutionError"
    this.aborted = aborted
    this.exitCode = exitCode
    this.#details = details
  }

  details(): string | undefined {
    return this.#details
  }
}

export const runCommand: RunCommand = (executable, args, options = {}) =>
  new Promise((resolve, reject) => {
    options.signal?.throwIfAborted()
    const operation = options.label ?? describeCommand(executable, args).label
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })
    const chunks: Buffer[] = []
    const diagnostics: Buffer[] = []
    const diagnosticLimit = 64 * 1024
    let diagnosticBytes = 0
    let diagnosticTruncated = false
    let bytes = 0
    let exceeded = false
    let termination: Promise<void> | undefined
    function signalChild(signal: NodeJS.Signals) {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
      }
    }
    function failCleanup() {
      reject(
        new CommandExecutionError(
          `${operation} failed during cancellation cleanup. Verify that the owned command and its descendants have stopped before retrying.`,
          options.signal?.aborted,
        ),
      )
    }
    const terminate = () => {
      if (termination) return
      termination = (async () => {
        const alive = () => {
          if (process.platform === "win32")
            return child.exitCode === null && child.signalCode === null
          if (!child.pid) return false
          try {
            process.kill(-child.pid, 0)
            return true
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
            throw error
          }
        }
        signalChild("SIGTERM")
        const deadline = performance.now() + 5_000
        while (alive() && performance.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 25))
        if (alive()) {
          signalChild("SIGKILL")
          const killed = performance.now() + 1_000
          while (alive() && performance.now() < killed)
            await new Promise((resolve) => setTimeout(resolve, 25))
        }
      })()
      termination.catch(failCleanup)
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
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = diagnosticLimit - diagnosticBytes
      if (chunk.length > remaining) diagnosticTruncated = true
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining)
        diagnostics.push(kept)
        diagnosticBytes += kept.length
      }
    })
    let couldNotStart = false
    child.on("error", () => {
      couldNotStart = true
    })
    child.on("close", async (code) => {
      try {
        await termination
      } catch {
        failCleanup()
        return
      } finally {
        options.signal?.removeEventListener("abort", terminate)
      }
      if (couldNotStart) {
        reject(
          new CommandExecutionError(
            `${operation} could not start. Check the tool installation and permissions.`,
            options.signal?.aborted,
          ),
        )
        return
      }
      if (code !== 0 || exceeded || options.signal?.aborted) {
        const reason = options.signal?.aborted
          ? "cancelled"
          : exceeded
            ? "output limit exceeded"
            : code === null
              ? "process terminated"
              : `exit code ${code}`
        const detail = stripVTControlCharacters(Buffer.concat(diagnostics).toString("utf8"))
          .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
          .trim()
        reject(
          new CommandExecutionError(
            `${operation} failed (${reason}).`,
            options.signal?.aborted,
            code ?? undefined,
            `${detail || "The command returned no error details."}${diagnosticTruncated ? "\nError details truncated after 64 KiB." : ""}`,
          ),
        )
      } else {
        resolve(Buffer.concat(chunks).toString("utf8").trim())
      }
    })
  })
