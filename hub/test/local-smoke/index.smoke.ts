import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { it } from "vitest"

import { getDatabaseUrl } from "../database/get-database-url"
import { withLocalSmokeHub } from "./with-local-smoke-hub"

const execute = promisify(execFile)
const browserScript = fileURLToPath(new URL("./browser.js", import.meta.url))

it("serves and revokes a saved Build through the real local Hub", async () => {
  await execute("playwright-cli", ["--version"]).catch((error: unknown) => {
    throw new Error("The local browser smoke test requires playwright-cli on PATH.", {
      cause: error,
    })
  })

  const root = await mkdtemp(join(tmpdir(), "replica-hub-smoke-"))
  try {
    await withLocalSmokeHub({ root, databaseUrl: getDatabaseUrl() }, async (hubUrl) => {
      const session = `hub-smoke-${randomUUID()}`
      function browser(...args: string[]) {
        return execute("playwright-cli", [`-s=${session}`, ...args], { cwd: root, timeout: 60_000 })
      }
      try {
        await browser("open", hubUrl, "--idle-timeout=90000")
        const { stdout } = await browser("--raw", "run-code", `--filename=${browserScript}`).catch(
          (error: unknown) => {
            if (error instanceof Error && "stdout" in error && typeof error.stdout === "string") {
              throw new Error(`The browser smoke did not finish.\n${error.stdout.trim()}`, {
                cause: error,
              })
            }
            throw error
          },
        )
        if (stdout.trim() !== JSON.stringify("local smoke passed")) {
          throw new Error(`The browser smoke did not finish.\n${stdout}`)
        }
      } finally {
        await browser("close")
      }
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)
