import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

describe("authentication proof migration", () => {
  it("upgrades the exact C1 schema before deploying C2", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
    const name = `replica_upgrade_${randomBytes(8).toString("hex")}`
    const admin = new pg.Client({ connectionString: adminUrl })
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`)
      const databaseUrl = new URL(adminUrl)
      databaseUrl.pathname = name
      const database = new pg.Client({ connectionString: databaseUrl.toString() })
      await database.connect()
      try {
        const hubRoot = fileURLToPath(new URL("../../../", import.meta.url))
        const migrationName = "20261029203000_identity_foundation"
        const migrationPath = join(hubRoot, "schema/migrations", migrationName, "migration.sql")
        await database.query(await readFile(migrationPath, "utf8"))
        const prisma = join(hubRoot, "node_modules/prisma/build/index.js")
        const options = {
          cwd: hubRoot,
          env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
          timeout: 60_000,
        }
        await promisify(execFile)(
          process.execPath,
          [prisma, "migrate", "resolve", "--applied", migrationName],
          options,
        )
        await promisify(execFile)(
          process.execPath,
          [prisma, "migrate", "deploy", "--config", join(hubRoot, "prisma7.config.ts")],
          options,
        )

        const migrations = await database.query<{ migration_name: string }>(
          "SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY started_at",
        )
        expect(migrations.rows).toEqual([
          { migration_name: "20261029203000_identity_foundation" },
          { migration_name: "20261030170000_authentication_proof" },
        ])
        const handoff = await database.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admission_handoffs'",
        )
        expect(handoff.rows).toEqual([{ table_name: "admission_handoffs" }])
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      await admin.end()
    }
  }, 30_000)
})
