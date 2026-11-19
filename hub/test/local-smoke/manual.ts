import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"

import { migrateJobDatabase } from "../../server/integrations/bullmq/migrate-job-database/index.ts"
import { withLocalSmokeHub } from "./with-local-smoke-hub/index.ts"

const adminUrl = URL.parse(process.env.TEST_DATABASE_URL ?? "")
if (
  !adminUrl ||
  !["postgresql:", "postgres:"].includes(adminUrl.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname) ||
  adminUrl.search ||
  adminUrl.hash
) {
  throw new Error("Set TEST_DATABASE_URL to a loopback PostgreSQL URL with CREATEDB permission.")
}

const hubRoot = fileURLToPath(new URL("../../", import.meta.url))
const name = `replica_smoke_${randomUUID().replaceAll("-", "")}`
const database = pg.escapeIdentifier(name)
const admin = new pg.Client({ connectionString: adminUrl.href, connectionTimeoutMillis: 10_000 })
const root = await mkdtemp(join(tmpdir(), "replica-hub-manual-"))
const stop = new AbortController()
function requestStop() {
  stop.abort()
}
process.once("SIGINT", requestStop)
process.once("SIGTERM", requestStop)
let created = false
try {
  await admin.connect()
  await admin.query(`CREATE DATABASE ${database}`)
  created = true
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = name
  await promisify(execFile)(
    process.execPath,
    [
      join(hubRoot, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--config",
      join(hubRoot, "prisma7.config.ts"),
    ],
    {
      cwd: root,
      env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl.href },
      timeout: 60_000,
    },
  )
  await migrateJobDatabase(databaseUrl.href)
  if (!stop.signal.aborted) {
    await withLocalSmokeHub(
      { root, databaseUrl: databaseUrl.href, manualStop: stop.signal },
      async (url) => {
        console.log(`Open ${url} and select "Sign in as local developer".`)
        console.log("Press Ctrl+C here to stop Hub and discard the smoke workspace.")
        if (!stop.signal.aborted) await once(stop.signal, "abort")
      },
    )
  }
} finally {
  try {
    if (created) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`)
  } finally {
    try {
      await admin.end()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
}
