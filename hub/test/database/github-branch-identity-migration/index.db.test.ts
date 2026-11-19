import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const migrationTestTimeoutMs = 120_000

describe("GitHub branch identity migration", () => {
  it(
    "leaves existing retirements without a deleted-head anchor and preserves retained history",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_branch_upgrade_${randomBytes(8).toString("hex")}`
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
          const firstPullRequestMigration = "20261210120000_github_workflow_builds"
          const base = (await readdir(migrations, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < firstPullRequestMigration)
            .map(({ name }) => name)
            .sort()
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
          const userId = randomUUID()
          const selectedPrototypeId = randomUUID()
          const unknownPrototypeId = randomUUID()
          const activePrototypeId = randomUUID()
          const selectedBuildId = randomUUID()
          const laterBuildId = randomUUID()
          const unselectedBuildId = randomUUID()
          const activeBuildId = randomUUID()
          await database.query(
            `INSERT INTO repositories (id, github_repository_id, name_with_owner, default_branch)
             VALUES ($1, 1001, 'team/design', 'main')`,
            [repositoryId],
          )
          await database.query("INSERT INTO users (id) VALUES ($1)", [userId])
          await database.query(
            `INSERT INTO prototypes
               (id, repository_id, branch_name, name, description, start_page, author_id,
                registered_at, branch_deleted_at)
             VALUES
               ($1, $4, 'proto/selected', 'Retained', 'Saved description', '/saved', $5,
                '2026-11-01T00:00:00Z', '2026-11-18T00:00:00Z'),
               ($2, $4, 'proto/unknown', NULL, NULL, NULL, NULL, NULL, '2026-11-18T00:00:00Z'),
               ($3, $4, 'proto/active', 'Active', NULL, NULL, NULL, NULL, NULL)`,
            [selectedPrototypeId, unknownPrototypeId, activePrototypeId, repositoryId, userId],
          )
          await database.query(
            `INSERT INTO builds (id, prototype_id, number, state, commit_sha, created_at)
             VALUES
               ($1, $5, 1, 'successful', $8, '2026-11-17T00:00:00Z'),
               ($2, $5, 2, 'successful', $9, '2026-11-19T00:00:00Z'),
               ($3, $6, 1, 'successful', $9, '2026-11-19T00:00:00Z'),
               ($4, $7, 1, 'successful', $9, '2026-11-17T00:00:00Z')`,
            [
              selectedBuildId,
              laterBuildId,
              unselectedBuildId,
              activeBuildId,
              selectedPrototypeId,
              unknownPrototypeId,
              activePrototypeId,
              "a".repeat(40),
              "b".repeat(40),
            ],
          )
          await database.query(`UPDATE prototypes SET current_build_id = $1 WHERE id = $2`, [
            selectedBuildId,
            selectedPrototypeId,
          ])
          await database.query(`UPDATE prototypes SET current_build_id = $1 WHERE id = $2`, [
            activeBuildId,
            activePrototypeId,
          ])
          await database.query(
            `INSERT INTO share_links
               (id, prototype_id, build_id, created_by_id, public_id, label, created_by_login, expires_at)
             VALUES ($1, $2, $3, $4, $5, 'Retained link', 'mona', '2099-01-01T00:00:00Z')`,
            [randomUUID(), selectedPrototypeId, selectedBuildId, userId, randomUUID()],
          )
          const repositoriesBefore = await database.query("SELECT * FROM repositories ORDER BY id")
          const prototypesBefore = await database.query("SELECT * FROM prototypes ORDER BY id")
          const buildsBefore = await database.query("SELECT * FROM builds ORDER BY id")
          const linksBefore = await database.query("SELECT * FROM share_links ORDER BY id")

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
                join(hubRoot, "prisma7.config.ts"),
              ],
              options,
            )
          }
          await run(
            process.execPath,
            [prismaCli, "migrate", "deploy", "--config", join(hubRoot, "prisma7.config.ts")],
            options,
          )

          for (const [table, before] of [
            ["repositories", repositoriesBefore],
            ["prototypes", prototypesBefore],
            ["builds", buildsBefore],
            ["share_links", linksBefore],
          ] as const) {
            const after = await database.query(`SELECT * FROM ${table} ORDER BY id`)
            expect(after.rows).toHaveLength(before.rows.length)
            for (const [index, row] of before.rows.entries()) {
              expect(after.rows[index]).toMatchObject(row)
            }
          }
          const identities = await database.query(
            `SELECT id, retired_head_sha, branch_head_sha, branch_presence_revision,
                    branch_identity_started_at, current_build_run_created_at,
                    current_build_run_id FROM prototypes`,
          )
          expect(identities.rows).toEqual(
            expect.arrayContaining([
              {
                id: selectedPrototypeId,
                retired_head_sha: null,
                branch_head_sha: null,
                branch_presence_revision: 0,
                branch_identity_started_at: null,
                current_build_run_created_at: null,
                current_build_run_id: null,
              },
              {
                id: unknownPrototypeId,
                retired_head_sha: null,
                branch_head_sha: null,
                branch_presence_revision: 0,
                branch_identity_started_at: null,
                current_build_run_created_at: null,
                current_build_run_id: null,
              },
              {
                id: activePrototypeId,
                retired_head_sha: null,
                branch_head_sha: null,
                branch_presence_revision: 0,
                branch_identity_started_at: null,
                current_build_run_created_at: null,
                current_build_run_id: null,
              },
            ]),
          )
          const checkpointId = randomUUID()
          await database.query(
            "INSERT INTO github_webhook_recovery_checkpoints (id, app_id) VALUES ($1, $2)",
            [checkpointId, "123"],
          )
          await expect(
            database.query(
              "INSERT INTO github_webhook_recovery_checkpoints (id, app_id) VALUES ($1, $2)",
              [randomUUID(), "123"],
            ),
          ).rejects.toMatchObject({ code: "23505" })
          await expect(
            database.query(
              "INSERT INTO github_webhook_recovery_checkpoints (id, app_id) VALUES ($1, $2)",
              [checkpointId, "456"],
            ),
          ).rejects.toMatchObject({ code: "23505" })
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
    migrationTestTimeoutMs,
  )
})
