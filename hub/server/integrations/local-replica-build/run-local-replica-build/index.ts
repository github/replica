import { spawn } from "node:child_process"
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"

import type { LocalReplicaBuildInput, LocalReplicaBuildResult } from "./types.ts"
import { localBuildExecutionTimeoutMs } from "../../../domains/local-builds/constants.ts"

const nodeImage =
  "node:24-bookworm@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0"

async function run(
  command: string,
  arguments_: string[],
  label: string,
  options: { timeoutMs?: number; onTimeout?: () => Promise<void> } = {},
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, arguments_, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      detached: process.platform !== "win32",
    })
    let output = ""
    function collect(chunk: Buffer) {
      output = `${output}${chunk.toString("utf8")}`.slice(-16_384)
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    let timeoutCleanup: Promise<void> | undefined
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        if (process.platform === "win32") child.kill("SIGKILL")
        else process.kill(-child.pid!, "SIGKILL")
        timeoutCleanup = options.onTimeout?.()
      }, options.timeoutMs)
    }
    child.once("error", reject)
    child.once("close", (code) => {
      void finish(code)
    })
    async function finish(code: number | null) {
      clearTimeout(timer)
      await timeoutCleanup
      if (code === 0) resolve()
      else {
        const detail = output.trim().split("\n").slice(-8).join("\n").slice(-800)
        reject(
          new Error(
            timedOut
              ? `${label} exceeded ${Math.ceil((options.timeoutMs ?? 0) / 60_000)} minutes.`
              : `${label} failed${detail ? `: ${detail}` : "."}`,
          ),
        )
      }
    }
  })
}

export async function runLocalReplicaBuild({
  repositoryPath,
  commitSha,
  actionRoot,
  temporaryRoot,
  executionTimeoutMs = localBuildExecutionTimeoutMs,
}: LocalReplicaBuildInput): Promise<LocalReplicaBuildResult> {
  await mkdir(temporaryRoot, { recursive: true })
  const directory = await mkdtemp(path.join(temporaryRoot, "replica-local-build-"))
  const checkout = path.join(directory, "checkout")
  const buildRoot = path.join(directory, "build-root")
  const screenshots = path.join(directory, "screenshots")
  const packageDirectory = path.join(directory, "replica-build-v1")
  let worktreeAdded = false

  async function cleanup() {
    if (worktreeAdded) {
      await run(
        "git",
        ["-C", repositoryPath, "worktree", "remove", "--force", checkout],
        "Build checkout cleanup",
      ).catch(() => undefined)
    }
    await rm(directory, { force: true, recursive: true })
  }

  try {
    await run(
      "git",
      ["-C", repositoryPath, "worktree", "add", "--detach", checkout, commitSha],
      "Committed checkout",
    )
    worktreeAdded = true
    await run(
      process.execPath,
      [path.join(actionRoot, "scripts/validate-repository/index.mjs"), "--root", checkout],
      "Repository validation",
    )
    const user = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`
    const containerName = `replica-local-build-${path.basename(directory)}`
    const npmEnvironment = [
      "npm_config_registry",
      "npm_config_replace_registry_host",
      "npm_config_maxsockets",
      "npm_config_fetch_retries",
      "npm_config_fetch_retry_mintimeout",
      "npm_config_fetch_retry_maxtimeout",
    ].flatMap((name) => (process.env[name] ? ["--env", `${name}=${process.env[name]}`] : []))
    await run(
      "docker",
      [
        "run",
        "--rm",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=512",
        "--memory=2g",
        "--cpus=2",
        "--name",
        containerName,
        "--user",
        user,
        "--env",
        "HOME=/tmp",
        ...npmEnvironment,
        "--mount",
        `type=bind,source=${checkout},target=/workspace`,
        "--workdir",
        "/workspace",
        nodeImage,
        "sh",
        "-lc",
        "npm ci && npm run build",
      ],
      "Prototype build",
      {
        timeoutMs: executionTimeoutMs,
        onTimeout: async () => {
          await run(
            "docker",
            ["rm", "--force", containerName],
            "Prototype container cleanup",
          ).catch(() => undefined)
        },
      },
    )
    await mkdir(buildRoot, { recursive: true })
    await cp(path.join(checkout, "dist"), path.join(buildRoot, "dist"), {
      recursive: true,
      verbatimSymlinks: true,
    })
    await run(
      process.execPath,
      [path.join(actionRoot, "scripts/validate-build-output/index.mjs"), "--root", buildRoot],
      "Build output validation",
    )
    await run(
      process.execPath,
      [
        path.join(actionRoot, "scripts/capture-screenshots/index.mjs"),
        "--root",
        buildRoot,
        "--config-root",
        checkout,
        "--screenshots",
        screenshots,
      ],
      "Screenshot capture",
      { timeoutMs: 5 * 60_000 },
    )
    await run(
      process.execPath,
      [
        path.join(actionRoot, "scripts/create-package/index.mjs"),
        "--root",
        buildRoot,
        "--screenshots",
        screenshots,
        "--output",
        packageDirectory,
      ],
      "Replica package creation",
    )

    return { packageDirectory, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
