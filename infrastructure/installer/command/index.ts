import { spawn } from "node:child_process"
import { stripVTControlCharacters } from "node:util"

import type { RunCommand } from "../types.ts"
import { describeCommand } from "./describe/index.ts"

export class CommandExecutionError extends Error {
  readonly aborted: boolean
  readonly exitCode: number | undefined

  constructor(message: string, aborted = false, exitCode?: number) {
    super(message)
    this.name = "CommandExecutionError"
    this.aborted = aborted
    this.exitCode = exitCode
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
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = diagnosticLimit - diagnosticBytes
      if (chunk.length > remaining) diagnosticTruncated = true
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining)
        diagnostics.push(kept)
        diagnosticBytes += kept.length
      }
    })
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
        const detail = stripVTControlCharacters(Buffer.concat(diagnostics).toString("utf8"))
          .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
          .trim()
        reject(
          new CommandExecutionError(
            `${operation} failed (${reason}).\n${detail || "The command returned no error details."}${diagnosticTruncated ? "\nError details truncated after 64 KiB." : ""}`,
            options.signal?.aborted,
            code ?? undefined,
          ),
        )
      } else {
        resolve(Buffer.concat(chunks).toString("utf8").trim())
      }
    })
  })
