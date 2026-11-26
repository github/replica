import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { describe, expect, it } from "vitest"

const timeoutMs = 60_000

describe("learning activity days migration", () => {
  it(
    "keeps the activity of runs that finished before the upgrade",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_activity_days_upgrade_${randomBytes(8).toString("hex")}`
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
          const migration = "20261222170000_learning_activity_days"
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
          const requesterId = randomUUID()
          await database.query(
            `INSERT INTO repositories (id, name_with_owner, default_branch)
             VALUES ($1, 'team/design', 'main')`,
            [repositoryId],
          )
          await database.query(`INSERT INTO users (id) VALUES ($1)`, [requesterId])
          await database.query(
            `INSERT INTO learning_runs
               (id, repository_id, requested_by_id, snapshot_digest, state, scheduled,
                comments_considered, comments_labeled, suggestions, started_at, created_at,
                finished_at, failure_code, failure_summary)
             VALUES
               ($1, $4, NULL, $5, 'SUCCEEDED', true, 4, 2, 1,
                '2026-12-01T23:30:00Z', '2026-12-01T23:00:00Z', '2026-12-01T23:40:00Z', NULL, NULL),
               ($2, $4, $6, $5, 'FAILED', false, 3, 1, 0,
                '2026-12-01T23:50:00Z', '2026-12-01T23:45:00Z', '2026-12-02T00:10:00Z',
                'runner_failed', 'The runner stopped.'),
               ($3, $4, NULL, $5, 'RUNNING', false, 9, 9, 9,
                '2026-12-01T23:55:00Z', '2026-12-01T23:55:00Z', NULL, NULL, NULL)`,
            [
              randomUUID(),
              randomUUID(),
              randomUUID(),
              repositoryId,
              `sha256:${"a".repeat(64)}`,
              requesterId,
            ],
          )

          await database.query(
            await readFile(join(migrationsRoot, migration, "migration.sql"), "utf8"),
          )

          const { rows } = await database.query(
            `SELECT to_char(date, 'YYYY-MM-DD') AS date, runs, comments_analyzed,
                    comments_tagged, suggestions, last_run_state, last_scheduled,
                    last_requested_by_id
             FROM learning_activity_days WHERE repository_id = $1`,
            [repositoryId],
          )
          expect(rows).toEqual([
            {
              date: "2026-12-01",
              runs: 2,
              comments_analyzed: 7,
              comments_tagged: 3,
              suggestions: 1,
              last_run_state: "FAILED",
              last_scheduled: false,
              last_requested_by_id: requesterId,
            },
          ])
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
