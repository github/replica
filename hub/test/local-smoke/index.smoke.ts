import { execFile, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { access, mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { expect, it, vi } from "vitest"

import { getDatabaseUrl } from "../database/get-database-url"
import { seedLocalWorkspace } from "./seed-local-workspace"

const execute = promisify(execFile)
const hubRoot = fileURLToPath(new URL("../../", import.meta.url))
const browserScript = fileURLToPath(new URL("./browser.js", import.meta.url))

async function findLoopbackPort() {
  const socket = createServer()
  socket.listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  await promisify(socket.close.bind(socket))()
  if (!address || typeof address === "string") throw new Error("Could not allocate a Hub port.")
  return address.port
}

it("serves and revokes a saved Build through the real local Hub", async () => {
  const clientDirectory = join(hubRoot, "dist/client")
  const entrypoint = join(hubRoot, "dist/server/index.js")
  await Promise.all([access(join(clientDirectory, "index.html")), access(entrypoint)]).catch(
    (error: unknown) => {
      throw new Error("Run npm run build:runtime before the local browser smoke test.", {
        cause: error,
      })
    },
  )
  await execute("playwright-cli", ["--version"]).catch((error: unknown) => {
    throw new Error("The local browser smoke test requires playwright-cli on PATH.", {
      cause: error,
    })
  })

  const root = await mkdtemp(join(tmpdir(), "replica-hub-smoke-"))
  try {
    const artifactDirectory = join(root, "artifacts")
    await mkdir(artifactDirectory)
    await seedLocalWorkspace(root, artifactDirectory)

    const port = await findLoopbackPort()
    const hubUrl = `http://localhost:${port}`
    const server = spawn(process.execPath, [entrypoint], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "development",
        HOST: "127.0.0.1",
        PORT: String(port),
        DATABASE_URL: getDatabaseUrl(),
        CLIENT_DIRECTORY: clientDirectory,
        HUB_LOCAL_SIGN_IN: "true",
        HUB_APPLICATION_ORIGIN: hubUrl,
        HUB_PREVIEW_ORIGIN: `http://preview.localhost:${port}`,
        ARTIFACT_STORAGE_PROVIDER: "filesystem",
        ARTIFACT_STORAGE_DIRECTORY: artifactDirectory,
        REPLICA_LEARNING_ROOT: join(root, "learning"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let startupOutput = ""
    server.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      startupOutput = (startupOutput + chunk).slice(-6000)
    })
    server.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      startupOutput = (startupOutput + chunk).slice(-6000)
    })
    const closed = once(server, "close")
    try {
      await Promise.race([
        closed.then(([code]) => {
          throw new Error(`Local Hub exited before it was ready (${code}).\n${startupOutput}`)
        }),
        vi.waitFor(
          async () => {
            expect(startupOutput).toContain("Hub API listening")
            const response = await fetch(`${hubUrl}/api/ready`, {
              signal: AbortSignal.timeout(1000),
            })
            expect(response.ok).toBe(true)
          },
          { timeout: 15_000 },
        ),
      ])

      const session = `hub-smoke-${randomUUID()}`
      function browser(...args: string[]) {
        return execute("playwright-cli", [`-s=${session}`, ...args], { cwd: root, timeout: 60_000 })
      }
      try {
        await browser("open", hubUrl, "--idle-timeout=90000")
        const { stdout } = await browser("--raw", "run-code", `--filename=${browserScript}`)
        if (stdout.trim() !== JSON.stringify("local smoke passed")) {
          throw new Error(`The browser smoke did not finish.\n${stdout}`)
        }
      } finally {
        await browser("close")
      }
    } finally {
      server.kill("SIGTERM")
      await closed
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)
