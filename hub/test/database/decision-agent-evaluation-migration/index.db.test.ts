import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { expect, it } from "vitest"

it("adds bounded content-free agent evaluation reservations to the exact decision base", async () => {
  const adminUrl = process.env.TEST_DATABASE_URL
  if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
  const name = `replica_agent_evaluation_${randomBytes(8).toString("hex")}`
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
      const migration = "20261219120000_decision_agent_evaluations"
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
      const jobId = randomUUID()
      const candidateId = randomUUID()
      await database.query(
        `INSERT INTO repositories (id, name_with_owner, default_branch)
         VALUES ($1, 'team/design', 'main')`,
        [repositoryId],
      )
      await database.query(
        `INSERT INTO decision_training_jobs
           (id, repository_id, idempotency_key, configuration_generation, state, backend,
            max_updates, max_seconds, budget_credits, consent_grant_id, training_export_id,
            evidence_digest, export_digest, repeatable_review_snapshot_digest, question_digest,
            build_set_digest, taskset_digest)
         VALUES ($1, $2, 'agent-migration', 1, 'SUCCEEDED', 'fixture', 8, 300, 10,
                 'grant', 'export', $3, $3, $3, $3, $3, $3)`,
        [jobId, repositoryId, `sha256:${"a".repeat(64)}`],
      )
      await database.query(
        `INSERT INTO decision_candidates
           (id, repository_id, training_job_id, runtime_candidate_id, taskset_digest,
            manifest_digest, evaluation_digest, production_eligible)
         VALUES ($1, $2, $3, 'runtime-candidate', $4, $4, $4, true)`,
        [candidateId, repositoryId, jobId, `sha256:${"b".repeat(64)}`],
      )

      const run = promisify(execFile)
      const options = {
        cwd: hubRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
        timeout: 120_000,
      }
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

      const columns = await database.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'decision_agent_evaluations'
         ORDER BY column_name`,
      )
      const names = columns.rows.map(({ column_name }) => column_name)
      for (const forbidden of ["screenshot", "learning_text", "prompt", "credential"]) {
        expect(names).not.toContain(forbidden)
      }
      await expect(
        database.query(
          `INSERT INTO decision_agent_evaluations
             (id, repository_id, candidate_id, cache_key, promotion_generation,
              question_digest, screenshot_set_digest, request_units, state, expires_at)
           VALUES ($1, $2, $3, $4, 1, $5, $6, 0, 'PENDING', now() + interval '15 minutes')`,
          [
            randomUUID(),
            repositoryId,
            candidateId,
            "c".repeat(64),
            `sha256:${"d".repeat(64)}`,
            `sha256:${"e".repeat(64)}`,
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" })
    } finally {
      await database.end()
    }
  } finally {
    if (created) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [name],
      )
      await admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)}`)
    }
    await admin.end()
  }
}, 120_000)
