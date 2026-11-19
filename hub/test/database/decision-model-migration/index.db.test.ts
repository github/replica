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
          const decisionMigration = "20261203140000_decision_model_control_plane"
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
          const userId = randomUUID()
          const membershipId = randomUUID()
          const jobId = randomUUID()
          const otherJobId = randomUUID()
          const candidateId = randomUUID()
          await database.query(`INSERT INTO users (id) VALUES ($1)`, [userId])
          await database.query(`INSERT INTO memberships (id, user_id) VALUES ($1, $2)`, [
            membershipId,
            userId,
          ])
          await database.query(
            `INSERT INTO decision_training_jobs
               (id, repository_id, requested_by_membership_id, idempotency_key,
                configuration_generation, state, backend, max_updates, max_seconds,
                budget_credits, consent_grant_id, export_digest,
                training_export_id, evidence_digest,
                repeatable_review_snapshot_digest, question_digest, build_set_digest,
                taskset_digest)
             VALUES ($1, $2, $3, 'migration-candidate', 1, 'SUCCEEDED', 'fixture',
                     8, 300, 10, 'grant', $4, $5, $6, $7, $8, $9, $10)`,
            [
              jobId,
              repositoryId,
              membershipId,
              `sha256:${"a".repeat(64)}`,
              "export_training",
              `sha256:${"9".repeat(64)}`,
              `sha256:${"b".repeat(64)}`,
              `sha256:${"c".repeat(64)}`,
              `sha256:${"d".repeat(64)}`,
              `sha256:${"e".repeat(64)}`,
            ],
          )
          await database.query(
            `INSERT INTO decision_training_jobs
               (id, repository_id, requested_by_membership_id, idempotency_key,
                configuration_generation, state, backend, max_updates, max_seconds,
                budget_credits, consent_grant_id, export_digest,
                training_export_id, evidence_digest,
                repeatable_review_snapshot_digest, question_digest, build_set_digest,
                taskset_digest)
             VALUES ($1, $2, $3, 'invalid-rejection-job', 1, 'SUCCEEDED', 'fixture',
                     8, 300, 10, 'grant', $4, $5, $6, $7, $8, $9, $10)`,
            [
              otherJobId,
              otherRepositoryId,
              membershipId,
              `sha256:${"a".repeat(64)}`,
              "export_training",
              `sha256:${"9".repeat(64)}`,
              `sha256:${"b".repeat(64)}`,
              `sha256:${"c".repeat(64)}`,
              `sha256:${"d".repeat(64)}`,
              `sha256:${"e".repeat(64)}`,
            ],
          )
          await database.query(
            `INSERT INTO decision_candidates
               (id, repository_id, training_job_id, runtime_candidate_id, taskset_digest,
                manifest_digest, evaluation_digest, production_eligible,
                rejected_by_membership_id, rejected_reason, rejected_at)
             VALUES ($1, $2, $3, 'runtime-candidate', $4, $5, $6, true, $7,
                     'Not suitable', clock_timestamp())`,
            [
              candidateId,
              repositoryId,
              jobId,
              `sha256:${"e".repeat(64)}`,
              `sha256:${"f".repeat(64)}`,
              `sha256:${"1".repeat(64)}`,
              membershipId,
            ],
          )
          await expect(
            database.query(
              `INSERT INTO decision_candidates
                 (id, repository_id, training_job_id, runtime_candidate_id, taskset_digest,
                  manifest_digest, evaluation_digest, production_eligible)
               VALUES ($1, $2, $3, 'cross-repository', $4, $5, $6, true)`,
              [
                randomUUID(),
                otherRepositoryId,
                jobId,
                `sha256:${"e".repeat(64)}`,
                `sha256:${"f".repeat(64)}`,
                `sha256:${"1".repeat(64)}`,
              ],
            ),
          ).rejects.toMatchObject({ code: "23514" })
          await expect(
            database.query(
              `INSERT INTO decision_candidates
                 (id, repository_id, training_job_id, runtime_candidate_id, taskset_digest,
                  manifest_digest, evaluation_digest, production_eligible, rejected_at)
               VALUES ($1, $2, $3, 'invalid-rejection', $4, $5, $6, true,
                       clock_timestamp())`,
              [
                randomUUID(),
                otherRepositoryId,
                jobId,
                `sha256:${"e".repeat(64)}`,
                `sha256:${"f".repeat(64)}`,
                `sha256:${"1".repeat(64)}`,
              ],
            ),
          ).rejects.toMatchObject({ code: "23514" })
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
