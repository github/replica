import { chmod, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

import { LearningCommandError } from "./errors.ts"

const passedVariables = new Set(["PATH", "HOME", "LANG", "LC_ALL", "TZ"])
const childVariables = [
  ...passedVariables,
  "COPILOT_GITHUB_TOKEN",
  "REPLICA_LEARNING_DATABASE_URL",
  "TMPDIR",
]
const bootstrap = `
  import { pathToFileURL } from "node:url";
  const allowed = new Set(${JSON.stringify(childVariables)});
  for (const name of Object.keys(process.env)) {
    if (!allowed.has(name)) delete process.env[name];
  }
  const [entryPoint, ...arguments_] = process.argv.slice(1);
  process.argv = [process.execPath, entryPoint, ...arguments_];
  await import(pathToFileURL(entryPoint).href);
`
const errorPattern = /^error \(([a-z_]+)\): (.+)$/m
const stopTimeoutMs = 1_000

function commandEnvironment(
  source: NodeJS.ProcessEnv,
  temporaryDirectory: string,
  githubToken?: string,
  learningDatabaseUrl?: string,
) {
  const environment: NodeJS.ProcessEnv = { TMPDIR: temporaryDirectory }
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && passedVariables.has(name)) {
      environment[name] = value
    }
  }
  if (githubToken) environment.COPILOT_GITHUB_TOKEN = githubToken
  if (learningDatabaseUrl) environment.REPLICA_LEARNING_DATABASE_URL = learningDatabaseUrl
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

async function stopRemainingProcessGroup(pid: number | undefined) {
  if (pid === undefined) return
  stopProcessTree(pid)
  const deadline = Date.now() + stopTimeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return
      throw error
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
  }
}

export async function runLearningCommand(
  arguments_: string[],
  {
    cliPath,
    directory,
    environment = process.env,
    errorLimit = 1024 * 1024,
    githubToken,
    learningDatabaseUrl,
    nodePath = process.execPath,
    outputLimit = 16 * 1024 * 1024,
    signal,
    timeoutMs = 60_000,
  }: {
    cliPath: string
    directory?: string
    environment?: NodeJS.ProcessEnv
    errorLimit?: number
    githubToken?: string
    learningDatabaseUrl?: string
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
    const commandArguments = [...arguments_]
    let hasDirectory = false
    if (learningDatabaseUrl) {
      let requireImport = false
      async function preserveExistingStore(directory: string) {
        try {
          if ((await readdir(directory)).length) requireImport = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
      }
      for (let index = 0; index < commandArguments.length; index += 1) {
        const argument = commandArguments[index]
        if (argument === "--dir") {
          const directory = commandArguments[index + 1]
          if (!directory || directory.startsWith("--"))
            throw new LearningCommandError("invalid_request", "The learning directory is missing.")
          await preserveExistingStore(directory)
          commandArguments[++index] = temporaryDirectory
          hasDirectory = true
        } else if (argument?.startsWith("--dir=")) {
          await preserveExistingStore(argument.slice("--dir=".length))
          commandArguments[index] = `--dir=${temporaryDirectory}`
          hasDirectory = true
        }
      }
      if (hasDirectory) {
        await writeFile(
          join(temporaryDirectory, "config.json"),
          JSON.stringify({
            schemaVersion: "replica.learning-config/v1",
            memory: { provider: "postgres", ...(requireImport ? { requireImport: true } : {}) },
            consolidation: {
              options: {
                signals: ["visual_quality", "accessibility", "usability", "content", "interaction"],
              },
            },
          }),
          { mode: 0o600, flag: "wx" },
        )
      }
    }
    const secrets = [learningDatabaseUrl, githubToken].filter((value): value is string =>
      Boolean(value),
    )
    if (learningDatabaseUrl) {
      try {
        const password = new URL(learningDatabaseUrl).password
        if (password) secrets.push(password, decodeURIComponent(password))
      } catch {
        // The command reports an invalid URL without requiring it to be parsed here.
      }
    }
    function redact(value: string) {
      return secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), value)
    }
    function redactResult(value: unknown): unknown {
      if (typeof value === "string") return redact(value)
      if (Array.isArray(value)) return value.map(redactResult)
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [redact(key), redactResult(item)]),
        )
      return value
    }
    return await new Promise<unknown>((resolve, reject) => {
      const child = spawn(
        nodePath,
        ["--input-type=module", "--eval", bootstrap, cliPath, ...commandArguments, "--json"],
        {
          cwd: directory ?? temporaryDirectory,
          detached: true,
          env: commandEnvironment(
            environment,
            temporaryDirectory,
            githubToken,
            hasDirectory ? learningDatabaseUrl : undefined,
          ),
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
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
      void closed.then(async (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        try {
          await stopRemainingProcessGroup(child.pid)
        } catch (error) {
          reject(
            new LearningCommandError(
              "learning_failed",
              "Hub could not stop the replica-learning process group.",
              { cause: error },
            ),
          )
          return
        }
        const stdout = Buffer.concat(output).toString("utf8")
        const stderr = redact(Buffer.concat(errors).toString("utf8").trim())
        if (code !== 0) {
          const match = errorPattern.exec(stderr)
          let result: unknown
          if (stdout.trim()) {
            try {
              result = redactResult(JSON.parse(stdout))
            } catch {
              result = undefined
            }
          }
          reject(
            new LearningCommandError(
              match?.[1] ?? (code === 2 ? "invalid_request" : "learning_failed"),
              match?.[2]?.trim() ||
                stderr.split("\n")[0]?.replace(/^error:\s*/, "") ||
                "replica-learning failed.",
              { result },
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
