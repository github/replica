import "dotenv/config"
import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import type { TestProject } from "vitest/node"

import { getWorkerDatabase } from "../get-worker-database/index.ts"

export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_DATABASE_URL
  if (!adminUrl) {
    throw new Error("Set TEST_DATABASE_URL to a PostgreSQL connection with CREATEDB permission.")
  }

  const database = {
    adminUrl,
    prefix: `replica_test_${randomBytes(8).toString("hex")}`,
    workers: project.config.maxWorkers ?? project.vitest.config.maxWorkers,
  }
  getWorkerDatabase(database, "1")

  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 10_000 })
  await admin.connect()
  const created: string[] = []

  async function teardown() {
    const errors: unknown[] = []
    for (const name of created.toReversed()) {
      try {
        await admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      await admin.end()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, "Could not remove test databases.")
  }

  try {
    const template = `${database.prefix}_template`
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(template)}`)
    created.push(template)
    const templateUrl = new URL(adminUrl)
    templateUrl.pathname = template
    const hubRoot = fileURLToPath(new URL("../../../", import.meta.url))
    await promisify(execFile)(
      process.execPath,
      [
        join(hubRoot, "node_modules/prisma/build/index.js"),
        "db",
        "push",
        "--config",
        join(hubRoot, "prisma7.config.ts"),
      ],
      {
        cwd: hubRoot,
        env: { ...process.env, DATABASE_URL: templateUrl.toString() },
        timeout: 60_000,
      },
    )

    for (let worker = 1; worker <= database.workers; worker++) {
      const name = `${database.prefix}_${worker}`
      await admin.query(
        `CREATE DATABASE ${pg.escapeIdentifier(name)} TEMPLATE ${pg.escapeIdentifier(template)}`,
      )
      created.push(name)
    }
    project.provide("testDatabase", database)
    return teardown
  } catch (error) {
    try {
      await teardown()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Test database setup and cleanup failed.", {
        cause: cleanupError,
      })
    }
    throw error
  }
}
