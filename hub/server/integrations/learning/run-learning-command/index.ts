import { chmod, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

import { LearningCommandError } from "./errors.ts"

const passedVariables = new Set(["PATH", "HOME", "LANG", "LC_ALL", "TZ"])
const errorPattern = /^error \(([a-z_]+)\): (.+)$/m
const stopTimeoutMs = 1_000

function commandEnvironment(
  source: NodeJS.ProcessEnv,
  temporaryDirectory: string,
  copilotToken?: string,
) {
  const environment: NodeJS.ProcessEnv = { TMPDIR: temporaryDirectory }
  for (const [name, value] of Object.entries(source)) {
    if (
      value !== undefined &&
      (passedVariables.has(name) || name.startsWith("REPLICA_LEARNING_"))
    ) {
      environment[name] = value
    }
  }
  if (copilotToken) environment.COPILOT_GITHUB_TOKEN = copilotToken
  return environment
}

function stopProcessTree(pid: number | undefined) {
  if (pid === undefined) return
  try {
    process.kill(-pid, "SIGKILL")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

export async function runLearningCommand(
  arguments_: string[],
  {
    cliPath,
    copilotToken,
    directory,
    environment = process.env,
    errorLimit = 1024 * 1024,
    nodePath = process.execPath,
    outputLimit = 16 * 1024 * 1024,
    signal,
    timeoutMs = 60_000,
  }: {
    cliPath: string
    copilotToken?: string
    directory?: string
    environment?: NodeJS.ProcessEnv
    errorLimit?: number
    nodePath?: string
    outputLimit?: number
    signal?: AbortSignal
    timeoutMs?: number
  },
): Promise<unknown> {
  try {
    if (!(await stat(cliPath)).isFile()) throw new Error("The entry point is not a file.")
  } catch (error) {
    throw new LearningCommandError(
      "not_installed",
      "The replica-learning command is not installed here.",
      { cause: error },
    )
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "replica-learning-"))
  await chmod(temporaryDirectory, 0o700)
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const child = spawn(nodePath, [cliPath, ...arguments_, "--json"], {
        cwd: directory ?? temporaryDirectory,
        detached: true,
        env: commandEnvironment(environment, temporaryDirectory, copilotToken),
        stdio: ["ignore", "pipe", "pipe"],
      })
      const output: Buffer[] = []
      const errors: Buffer[] = []
      const closed = new Promise<number | null>((resolve) => {
        child.once("close", resolve)
      })
      let outputBytes = 0
      let errorBytes = 0
      let settled = false
      async function fail(error: Error) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        try {
          stopProcessTree(child.pid)
        } catch (stopError) {
          error = new AggregateError(
            [error, stopError],
            "replica-learning failed and Hub could not stop its process group.",
            { cause: error },
          )
        }
        child.stdout.destroy()
        child.stderr.destroy()
        await Promise.race([
          closed,
          new Promise<void>((resolve) => {
            setTimeout(resolve, stopTimeoutMs)
          }),
        ])
        reject(error)
      }
      function abort() {
        void fail(
          signal?.reason instanceof Error
            ? signal.reason
            : new LearningCommandError("cancelled", "replica-learning was cancelled."),
        )
      }
      const timer = setTimeout(() => {
        void fail(
          new LearningCommandError(
            "timeout",
            `replica-learning did not finish within ${Math.ceil(timeoutMs / 1000)} seconds.`,
          ),
        )
      }, timeoutMs)
      signal?.addEventListener("abort", abort, { once: true })
      if (signal?.aborted) abort()
      child.once("error", (error) => {
        void fail(
          new LearningCommandError(
            "not_installed",
            "Node.js or the replica-learning command is not installed here.",
            { cause: error },
          ),
        )
      })
      child.stdout.on("data", (piece: Buffer) => {
        if (settled) return
        outputBytes += piece.length
        if (outputBytes > outputLimit) {
          void fail(
            new LearningCommandError(
              "output_too_large",
              "replica-learning wrote more output than Hub accepts, so Hub stopped it.",
            ),
          )
          return
        }
        output.push(piece)
      })
      child.stderr.on("data", (piece: Buffer) => {
        if (settled) return
        errorBytes += piece.length
        if (errorBytes > errorLimit) {
          void fail(
            new LearningCommandError(
              "output_too_large",
              "replica-learning wrote more error output than Hub accepts, so Hub stopped it.",
            ),
          )
          return
        }
        errors.push(piece)
      })
      void closed.then((code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        const stdout = Buffer.concat(output).toString("utf8")
        const stderr = Buffer.concat(errors).toString("utf8").trim()
        if (code !== 0) {
          const match = errorPattern.exec(stderr)
          reject(
            new LearningCommandError(
              match?.[1] ?? (code === 2 ? "invalid_request" : "learning_failed"),
              match?.[2]?.trim() ||
                stderr.split("\n")[0]?.replace(/^error:\s*/, "") ||
                "replica-learning failed.",
            ),
          )
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch (error) {
          reject(
            new LearningCommandError(
              "unreadable_output",
              "replica-learning returned output Hub could not read.",
              { cause: error },
            ),
          )
        }
      })
    })
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}
