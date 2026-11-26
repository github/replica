import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const timeoutMs = 180_000
const baseMigration = "20261225090000_learning_evaluation_runs"
const migration = "20261226090000_reviewer_verified_scores"

describe("reviewer verified scores migration", () => {
  it(
    "keeps existing scores as usage scores and lets one verified score join each",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_verified_upgrade_${randomBytes(8).toString("hex")}`
      const admin = new pg.Client({ connectionString: adminUrl })
      await admin.connect()
      let created = false
      try {
        await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`)
        created = true
        const databaseUrl = new URL(adminUrl)
        databaseUrl.pathname = name
        const database = new pg.Client({ connectionString: databaseUrl.toString() })
        try {
          await database.connect()
          const hubRoot = fileURLToPath(new URL("../../../", import.meta.url))
          const migrationsRoot = join(hubRoot, "schema/migrations")
          const base = (await readdir(migrationsRoot, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name <= baseMigration)
            .map((entry) => entry.name)
            .sort()
          expect(base.at(-1)).toBe(baseMigration)

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
          const operationId = randomUUID()
          await database.query(
            `INSERT INTO repositories (id, github_repository_id, name_with_owner, default_branch)
             VALUES ($1, 1001, 'team/scored', 'main')`,
            [repositoryId],
          )
          await database.query(
            `INSERT INTO learning_evaluation_runs
               (id, repository_id, used_learning_id, operation_id, state, copilot_requests,
                ai_credits, score_id, finished_at)
             VALUES ($1, $2, 'use_1', $3, 'SUCCEEDED', 1, 0.5, 'score_1',
                     '2026-12-01T10:00:00Z')`,
            [runId, repositoryId, operationId],
          )
          await database.query(
            `INSERT INTO learning_score_requests (id, repository_id, commit_sha)
             VALUES ($1, $2, $3)`,
            [randomUUID(), repositoryId, "a".repeat(40)],
          )

          const run = promisify(execFile)
          const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: timeoutMs,
          }
          for (const migrationName of base) {
            await run(
              process.execPath,
              [
                prismaCli,
                "migrate",
                "resolve",
                "--applied",
                migrationName,
                "--config",
                "prisma7.config.ts",
              ],
              options,
            )
          }
          await run(
            process.execPath,
            [prismaCli, "migrate", "deploy", "--config", "prisma7.config.ts"],
            options,
          )

          expect(
            (
              await database.query(
                `SELECT migration_name FROM _prisma_migrations
                 WHERE migration_name = $1 AND finished_at IS NOT NULL`,
                [migration],
              )
            ).rows,
          ).toEqual([{ migration_name: migration }])
          expect(
            (
              await database.query(
                `SELECT id, operation_id, trigger, state, score_id, ai_credits::text
                 FROM learning_evaluation_runs`,
              )
            ).rows,
          ).toEqual([
            {
              id: runId,
              operation_id: operationId,
              trigger: "USAGE",
              state: "SUCCEEDED",
              score_id: "score_1",
              ai_credits: "0.500000000",
            },
          ])
          expect(
            (await database.query("SELECT commit_sha FROM learning_score_requests")).rows,
          ).toEqual([{ commit_sha: "a".repeat(40) }])

          const insert = `INSERT INTO learning_evaluation_runs
                            (id, repository_id, used_learning_id, operation_id, trigger)
                          VALUES ($1, $2, 'use_1', $3, 'REVIEWER_VERIFICATION')`
          await database.query(insert, [randomUUID(), repositoryId, randomUUID()])
          await expect(
            database.query(insert, [randomUUID(), repositoryId, randomUUID()]),
          ).rejects.toMatchObject({ code: "23505" })
        } finally {
          await database.end()
        }
      } finally {
        try {
          if (created) await admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)} WITH (FORCE)`)
        } finally {
          await admin.end()
        }
      }
    },
    timeoutMs,
  )
})
