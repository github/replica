import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const timeoutMs = 60_000

describe("learning review activity migration", () => {
  it(
    "preserves the exact base and adds optional persisted review activity snapshots",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_learning_activity_upgrade_${randomBytes(8).toString("hex")}`
      const admin = new pg.Client({ connectionString: adminUrl })
      await admin.connect()
      let created = false
      try {
        await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`)
        created = true
        const databaseUrl = new URL(adminUrl)
        databaseUrl.pathname = name
        const database = new pg.Client({ connectionString: databaseUrl.toString() })
        await database.connect()
        try {
          const hubRoot = fileURLToPath(new URL("../../../", import.meta.url))
          const migrationsRoot = join(hubRoot, "schema/migrations")
          const migration = "20261203140000_learning_review_activity_snapshots"
          const base = (await readdir(migrationsRoot, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < migration)
            .map((entry) => entry.name)
            .sort()
          for (const migrationName of base) {
            const sql = await readFile(join(migrationsRoot, migrationName, "migration.sql"), "utf8")
            if (migrationName === "20261104190000_entra_oidc_authentication") {
              const statements = sql.split("\n")
              await database.query(statements.slice(0, 2).join("\n"))
              await database.query(statements.slice(2).join("\n"))
            } else {
              await database.query(sql)
            }
          }

          const repositoryId = randomUUID()
          const runId = randomUUID()
          await database.query(
            `INSERT INTO repositories (id, name_with_owner, default_branch)
             VALUES ($1, 'team/design', 'main')`,
            [repositoryId],
          )
          await database.query(
            `INSERT INTO learning_runs
               (id, repository_id, snapshot_digest, state, started_at, finished_at)
             VALUES ($1, $2, $3, 'SUCCEEDED', clock_timestamp(), clock_timestamp())`,
            [runId, repositoryId, `sha256:${"a".repeat(64)}`],
          )

          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: timeoutMs,
          }
          const run = promisify(execFile)
          for (const migrationName of base) {
            await run(
              "prisma",
              [
                "migrate",
                "resolve",
                "--applied",
                migrationName,
                "--config",
                join(hubRoot, "prisma7.config.ts"),
              ],
              options,
            )
          }
          await run(
            "prisma",
            ["migrate", "deploy", "--config", join(hubRoot, "prisma7.config.ts")],
            options,
          )

          expect(
            (
              await database.query(
                `SELECT review_activity_snapshot FROM learning_runs WHERE id = $1`,
                [runId],
              )
            ).rows,
          ).toEqual([{ review_activity_snapshot: null }])
          const activity = { "11111111-1111-4111-8111-111111111111": 3 }
          await database.query(
            `UPDATE learning_runs SET review_activity_snapshot = $2::jsonb WHERE id = $1`,
            [runId, JSON.stringify(activity)],
          )
          expect(
            (
              await database.query(
                `SELECT review_activity_snapshot FROM learning_runs WHERE id = $1`,
                [runId],
              )
            ).rows,
          ).toEqual([{ review_activity_snapshot: activity }])
        } finally {
          await database.end()
        }
      } finally {
        try {
          if (created) {
            await admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)} WITH (FORCE)`)
          }
        } finally {
          await admin.end()
        }
      }
    },
    timeoutMs,
  )
})
