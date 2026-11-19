import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const timeoutMs = 60_000

describe("decision-model migration", () => {
  it(
    "upgrades the exact base and enforces bounded secret-free control-plane records",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_decision_upgrade_${randomBytes(8).toString("hex")}`
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
          const decisionMigration = "20261203150000_decision_model_ux_contracts"
          const baseMigrations = (await readdir(migrationsRoot, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < decisionMigration)
            .map((entry) => entry.name)
            .sort()
          for (const migrationName of baseMigrations) {
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
          const otherRepositoryId = randomUUID()
          await database.query(
            `INSERT INTO repositories (id, name_with_owner, default_branch)
             VALUES
               ($1, 'team/design', 'main'),
               ($2, 'team/other', 'main')`,
            [repositoryId, otherRepositoryId],
          )

          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: timeoutMs,
          }
          const run = promisify(execFile)
          for (const migrationName of baseMigrations) {
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

          await database.query(
            `INSERT INTO decision_model_configurations
               (id, repository_id, enabled, backend, max_updates, max_seconds,
                monthly_budget_credits)
             VALUES ($1, $2, true, 'customer-gpu', 8, 300, 10)`,
            [randomUUID(), repositoryId],
          )
          await expect(
            database.query(
              `INSERT INTO decision_model_configurations
                 (id, repository_id, enabled, backend, max_updates, max_seconds,
                  monthly_budget_credits)
               VALUES ($1, $2, true, 'customer-gpu', 0, 300, 10)`,
              [randomUUID(), otherRepositoryId],
            ),
          ).rejects.toMatchObject({ code: "23514" })
          const columns = await database.query<{ column_name: string }>(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name IN (
                 'decision_model_configurations',
                 'decision_training_jobs',
                 'decision_candidates',
                 'decision_model_promotions',
                 'decision_build_evaluations'
               )`,
          )
          expect(
            columns.rows.some(({ column_name }) =>
              /(credential|secret|token|adapter|weight)/.test(column_name),
            ),
          ).toBe(false)
          const candidateColumns = columns.rows.map(({ column_name }) => column_name)
          expect(candidateColumns).toEqual(
            expect.arrayContaining([
              "baseline_mean_reward",
              "candidate_mean_reward",
              "baseline_calibration_error",
              "candidate_calibration_error",
              "learning_metrics",
              "duration_seconds",
              "rejected_reason",
              "rejected_at",
            ]),
          )
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
