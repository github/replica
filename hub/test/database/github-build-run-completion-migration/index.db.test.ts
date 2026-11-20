import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import pg from "pg"
import { describe, expect, it } from "vitest"

const migrationTestTimeoutMs = 120_000
// Last migration at the exact base, 1cf8ab2c63e931ca8034f7e4fd637a06e281f7bc.
const baseMigration = "20261217120000_github_recovery_ordering"

describe("GitHub Build run completion migration", () => {
  it(
    "preserves the owning run and immutable artifacts while allowing per-run completion receipts",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_run_completion_upgrade_${randomBytes(8).toString("hex")}`
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
          const migrations = join(hubRoot, "schema/migrations")
          const base = (await readdir(migrations, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name <= baseMigration)
            .map(({ name }) => name)
            .sort()
          expect(base.at(-1)).toBe(baseMigration)
          for (const migrationName of base) {
            const sql = await readFile(join(migrations, migrationName, "migration.sql"), "utf8")
            if (migrationName === "20261104190000_entra_oidc_authentication") {
              const statements = sql.split("\n")
              await database.query(statements.slice(0, 2).join("\n"))
              await database.query(statements.slice(2).join("\n"))
            } else {
              await database.query(sql)
            }
          }

          const repositoryId = randomUUID()
          const prototypeId = randomUUID()
          const buildId = randomUUID()
          const completedAt = new Date("2026-11-18T12:05:00Z")
          await database.query(
            `INSERT INTO repositories (id, github_repository_id, name_with_owner, default_branch)
             VALUES ($1, 1001, 'team/design', 'main')`,
            [repositoryId],
          )
          await database.query(
            `INSERT INTO prototypes
               (id, repository_id, branch_name, name, registered_at, branch_head_sha,
                current_build_run_created_at, current_build_run_id)
             VALUES ($1, $2, 'proto/welcome', 'Welcome', '2026-11-18T12:01:00Z', $3,
                     '2026-11-18T12:00:00Z', 100)`,
            [prototypeId, repositoryId, "a".repeat(40)],
          )
          await database.query(
            `INSERT INTO builds
               (id, prototype_id, number, state, commit_sha, github_workflow_run_id,
                github_workflow_run_attempt, workflow_url, workflow_created_at,
                started_at, finished_at, workflow_completed_at, dist_digest)
             VALUES ($1, $2, 1, 'successful', $3, 100, 2,
                     'https://github.com/team/design/actions/runs/100',
                     '2026-11-18T12:00:00Z', '2026-11-18T12:00:00Z',
                     '2026-11-18T12:01:00Z', $4, $5)`,
            [buildId, prototypeId, "a".repeat(40), completedAt, "sha256:" + "b".repeat(64)],
          )
          await database.query("UPDATE prototypes SET current_build_id = $1 WHERE id = $2", [
            buildId,
            prototypeId,
          ])
          await database.query(
            `INSERT INTO build_artifacts (id, build_id, kind, path, storage_key, byte_length)
             VALUES ($1, $3, 'dist', 'dist/index.html', 'retained-dist', 20),
                    ($2, $3, 'screenshot', 'screenshots/desktop.png', 'retained-screenshot', 30)`,
            [randomUUID(), randomUUID(), buildId],
          )
          async function retainedBuild() {
            const build = await database.query(
              `SELECT repo.github_repository_id, prototype.id AS prototype_id,
                      prototype.name, prototype.registered_at, prototype.current_build_id,
                      prototype.branch_head_sha, prototype.current_build_run_created_at,
                      prototype.current_build_run_id, build.id AS build_id, build.state,
                      build.commit_sha, build.github_workflow_run_id,
                      build.github_workflow_run_attempt, build.workflow_url,
                      build.workflow_created_at, build.started_at, build.finished_at,
                      build.workflow_completed_at, build.dist_digest
               FROM builds build
               JOIN prototypes prototype ON prototype.id = build.prototype_id
               JOIN repositories repo ON repo.id = prototype.repository_id
               WHERE build.id = $1`,
              [buildId],
            )
            const artifacts = await database.query(
              `SELECT id, build_id, kind, path, storage_key, byte_length
               FROM build_artifacts WHERE build_id = $1 ORDER BY path`,
              [buildId],
            )
            return { builds: build.rows, artifacts: artifacts.rows }
          }
          const before = await retainedBuild()
          expect(before.builds).toHaveLength(1)
          expect(before.artifacts).toHaveLength(2)

          const run = promisify(execFile)
          const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: migrationTestTimeoutMs,
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

          expect(await retainedBuild()).toEqual(before)
          expect(
            (await database.query("SELECT id FROM github_build_run_completions")).rows,
          ).toEqual([])
          const receiptId = randomUUID()
          const insert = `INSERT INTO github_build_run_completions
                            (id, build_id, github_workflow_run_id, run_attempt, completed_at)
                          VALUES ($1, $2, 101, 1, $3)`
          await database.query(insert, [receiptId, buildId, completedAt])
          await expect(
            database.query(insert, [randomUUID(), buildId, completedAt]),
          ).rejects.toMatchObject({ code: "23505" })
          await expect(
            database.query(insert, [randomUUID(), randomUUID(), completedAt]),
          ).rejects.toMatchObject({ code: "23503" })
          const receipts = await database.query(
            `SELECT id, build_id, github_workflow_run_id, run_attempt, completed_at
             FROM github_build_run_completions`,
          )
          expect(receipts.rows).toEqual([
            {
              id: receiptId,
              build_id: buildId,
              github_workflow_run_id: "101",
              run_attempt: 1,
              completed_at: completedAt,
            },
          ])
          const otherBuildId = randomUUID()
          await database.query(
            `INSERT INTO builds (id, prototype_id, number, state)
             VALUES ($1, $2, 2, 'successful')`,
            [otherBuildId, prototypeId],
          )
          await database.query(insert, [randomUUID(), otherBuildId, completedAt])
          await expect(
            database.query("DELETE FROM builds WHERE id = $1", [otherBuildId]),
          ).rejects.toMatchObject({ code: "23503" })
          expect(await retainedBuild()).toEqual(before)
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
    migrationTestTimeoutMs,
  )
})
